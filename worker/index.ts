import crypto from "node:crypto";
import { decryptSecret } from "../lib/crypto";
import { pool, transaction } from "../lib/db";
import { findReplyInThread, renderMessage, sendGmailMessage } from "../lib/google";

type Job = {
  id: string;
  workspace_id: string;
  campaign_id: string;
  contact_id: string;
  email: string;
  name: string;
  company: string;
  custom_fields: Record<string, unknown>;
  subject: string;
  body_text: string;
  encrypted_access_token: string | null;
  encrypted_refresh_token: string;
  google_email: string;
};

const workerId = `worker-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
const pollInterval = Number(process.env.WORKER_POLL_INTERVAL_MS || 15000);

async function claimJob() {
  return transaction(async (client) => {
    const result = await client.query<Job>(
      `SELECT j.id,j.workspace_id,j.campaign_id,j.contact_id,c.email,c.name,c.company,c.custom_fields,
              t.subject,t.body_text,g.encrypted_access_token,g.encrypted_refresh_token,g.google_email
       FROM email_jobs j
       JOIN contacts c ON c.id=j.contact_id
       JOIN message_templates t ON t.id=j.template_id
       JOIN google_connections g ON g.workspace_id=j.workspace_id
       JOIN workspaces w ON w.id=j.workspace_id
       WHERE j.status='SCHEDULED' AND j.scheduled_at<=now() AND w.sending_enabled=true
         AND c.status NOT IN ('DO_NOT_CONTACT','REPLIED','PAUSED')
       ORDER BY j.scheduled_at
       FOR UPDATE OF j SKIP LOCKED LIMIT 1`,
    );
    const job = result.rows[0];
    if (!job) return null;
    await client.query("UPDATE email_jobs SET status='PROCESSING',started_at=now(),attempt_count=attempt_count+1,locked_by=$1,updated_at=now() WHERE id=$2", [workerId, job.id]);
    await client.query("UPDATE contacts SET status='PROCESSING',updated_at=now() WHERE id=$1", [job.contact_id]);
    return job;
  });
}

async function processJob(job: Job) {
  const values = { nombre: job.name, empresa: job.company, email: job.email, ...job.custom_fields };
  const subject = renderMessage(job.subject, values);
  const body = renderMessage(job.body_text, values);
  try {
    const sent = await sendGmailMessage({
      accessToken: job.encrypted_access_token ? decryptSecret(job.encrypted_access_token) : undefined,
      refreshToken: decryptSecret(job.encrypted_refresh_token),
      to: job.email,
      subject,
      body,
      senderEmail: job.google_email,
    });
    await transaction(async (client) => {
      await client.query("UPDATE email_jobs SET status='SENT',sent_at=now(),rendered_subject=$1,rendered_body=$2,gmail_message_id=$3,gmail_thread_id=$4,error_message=null,updated_at=now() WHERE id=$5", [subject, body, sent.messageId, sent.threadId, job.id]);
      await client.query("UPDATE contacts SET status='SENT',last_contacted_at=now(),last_error=null,updated_at=now() WHERE id=$1", [job.contact_id]);
      await client.query("INSERT INTO audit_logs(workspace_id,action,entity_type,entity_id,metadata) VALUES($1,'EMAIL_SENT','EMAIL_JOB',$2,$3)", [job.workspace_id, job.id, JSON.stringify({ detail: `Correo enviado a ${job.email}`, gmailMessageId: sent.messageId, gmailThreadId: sent.threadId })]);
      await client.query(
        `UPDATE campaigns SET status='COMPLETED',updated_at=now()
         WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM email_jobs WHERE campaign_id=$1 AND status IN ('SCHEDULED','PROCESSING'))`,
        [job.campaign_id],
      );
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await transaction(async (client) => {
      await client.query("UPDATE email_jobs SET status='ERROR',rendered_subject=$1,rendered_body=$2,error_message=$3,updated_at=now() WHERE id=$4", [subject, body, message.slice(0, 1000), job.id]);
      await client.query("UPDATE contacts SET status='ERROR',last_error=$1,updated_at=now() WHERE id=$2", [message.slice(0, 1000), job.contact_id]);
      await client.query("INSERT INTO audit_logs(workspace_id,action,entity_type,entity_id,metadata) VALUES($1,'EMAIL_ERROR','EMAIL_JOB',$2,$3)", [job.workspace_id, job.id, JSON.stringify({ detail: `Falló el envío a ${job.email}`, error: message })]);
      await client.query(
        `UPDATE campaigns SET status='COMPLETED',updated_at=now()
         WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM email_jobs WHERE campaign_id=$1 AND status IN ('SCHEDULED','PROCESSING'))`,
        [job.campaign_id],
      );
    });
  }
}

type ReplyCheck = {
  id: string;
  workspace_id: string;
  contact_id: string;
  gmail_message_id: string;
  gmail_thread_id: string;
  sent_at: Date;
  google_email: string;
  encrypted_access_token: string | null;
  encrypted_refresh_token: string;
};

async function checkOneReply() {
  const result = await pool().query<ReplyCheck>(
    `SELECT j.id,j.workspace_id,j.contact_id,j.gmail_message_id,j.gmail_thread_id,j.sent_at,
            g.google_email,g.encrypted_access_token,g.encrypted_refresh_token
     FROM email_jobs j JOIN google_connections g ON g.workspace_id=j.workspace_id
     WHERE j.status='SENT' AND j.reply_detected_at IS NULL AND j.gmail_thread_id IS NOT NULL
       AND j.sent_at > now() - interval '120 days'
     ORDER BY j.last_reply_checked_at NULLS FIRST,j.sent_at DESC LIMIT 1`,
  );
  const item = result.rows[0];
  if (!item) return;
  try {
    const reply = await findReplyInThread({
      accessToken: item.encrypted_access_token ? decryptSecret(item.encrypted_access_token) : undefined,
      refreshToken: decryptSecret(item.encrypted_refresh_token),
      threadId: item.gmail_thread_id,
      sentMessageId: item.gmail_message_id,
      accountEmail: item.google_email,
      sentAt: item.sent_at,
    });
    await transaction(async (client) => {
      if (reply) {
        await client.query("UPDATE email_jobs SET reply_message_id=$1,reply_from=$2,reply_detected_at=$3,last_reply_checked_at=now(),updated_at=now() WHERE id=$4", [reply.messageId, reply.from, reply.receivedAt, item.id]);
        await client.query("UPDATE contacts SET status='REPLIED',updated_at=now() WHERE id=$1 AND status NOT IN ('DO_NOT_CONTACT')", [item.contact_id]);
        await client.query("INSERT INTO audit_logs(workspace_id,action,entity_type,entity_id,metadata) VALUES($1,'REPLY_DETECTED','EMAIL_JOB',$2,$3)", [item.workspace_id, item.id, JSON.stringify({ detail: `Respuesta detectada de ${reply.from}`, replyMessageId: reply.messageId })]);
      } else {
        await client.query("UPDATE email_jobs SET last_reply_checked_at=now(),updated_at=now() WHERE id=$1", [item.id]);
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${workerId}] no se pudo revisar el hilo ${item.gmail_thread_id}: ${message}`);
    await pool().query("UPDATE email_jobs SET last_reply_checked_at=now(),updated_at=now() WHERE id=$1", [item.id]);
  }
}

async function tick() {
  const job = await claimJob();
  if (job) await processJob(job);
  await checkOneReply();
}

async function main() {
  console.log(`[${workerId}] iniciado; intervalo ${pollInterval} ms`);
  while (true) {
    try { await tick(); }
    catch (error) { console.error(`[${workerId}]`, error); }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
}

process.on("SIGTERM", async () => { await pool().end(); process.exit(0); });
void main();
