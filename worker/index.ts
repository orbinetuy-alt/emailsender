import crypto from "node:crypto";
import { decryptSecret } from "../lib/crypto";
import { pool, transaction } from "../lib/db";
import { findReplyInThread, getGmailRfcMessageId, renderMessage, sendGmailMessage } from "../lib/google";

type Job = {
  id: string;
  workspace_id: string;
  campaign_id: string;
  contact_id: string;
  contact_snapshot: Record<string, unknown> | null;
  step_number: number;
  email: string;
  name: string;
  company: string;
  company_type: string;
  hub: string;
  network: string;
  job_title: string;
  city: string;
  custom_fields: Record<string, unknown>;
  subject: string;
  body_text: string;
  encrypted_access_token: string | null;
  encrypted_refresh_token: string;
  google_email: string;
};

const workerId = `worker-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
const pollInterval = Number(process.env.WORKER_POLL_INTERVAL_MS || 15000);
let lastCleanup = 0;

async function cleanupUnassignedContacts() {
  if (Date.now() - lastCleanup < 60 * 60 * 1000) return;
  await transaction(async (client) => {
    // Las filas del Excel sin campaña son material temporal de selección.
    await client.query("DELETE FROM contact_imports WHERE created_at < now()-interval '24 hours'");
    await client.query(`DELETE FROM contacts c
      WHERE COALESCE(c.last_imported_at,c.created_at) < now()-interval '24 hours'
      AND NOT EXISTS (SELECT 1 FROM email_jobs j WHERE j.contact_id=c.id)
      AND NOT EXISTS (SELECT 1 FROM contact_import_items ii WHERE ii.contact_id=c.id)`);
    await client.query("DELETE FROM worker_heartbeats WHERE last_seen_at < now()-interval '7 days'");
  });
  lastCleanup = Date.now();
}

async function claimJob() {
  return transaction(async (client) => {
    const result = await client.query<Job>(
      `SELECT j.id,j.workspace_id,j.campaign_id,j.contact_id,j.contact_snapshot,j.step_number,c.email,c.name,c.company,c.company_type,c.hub,c.network,c.job_title,c.city,c.custom_fields,
              COALESCE(j.subject_snapshot,t.subject) AS subject,COALESCE(j.body_snapshot,t.body_text) AS body_text,g.encrypted_access_token,g.encrypted_refresh_token,g.google_email
       FROM email_jobs j
       JOIN contacts c ON c.id=j.contact_id
       JOIN message_templates t ON t.id=j.template_id
       JOIN google_connections g ON g.workspace_id=j.workspace_id
       JOIN workspaces w ON w.id=j.workspace_id
       JOIN campaigns campaign ON campaign.id=j.campaign_id
       WHERE j.status='SCHEDULED' AND j.scheduled_at<=now() AND w.sending_enabled=true AND g.encrypted_refresh_token IS NOT NULL
         AND campaign.status IN ('SCHEDULED','RUNNING')
         AND ((j.step_number=0 AND c.status='QUEUED') OR (j.step_number>0 AND c.status='SENT'))
         AND NOT EXISTS (SELECT 1 FROM email_jobs recent WHERE recent.campaign_id=j.campaign_id AND recent.status='SENT'
           AND recent.sent_at > now() - (campaign.interval_minutes * interval '1 minute'))
         AND NOT EXISTS (SELECT 1 FROM email_jobs recent WHERE recent.workspace_id=j.workspace_id AND recent.status='SENT'
           AND recent.sent_at > now() - (w.send_interval_minutes * interval '1 minute'))
         AND NOT EXISTS (SELECT 1 FROM email_jobs running WHERE running.workspace_id=j.workspace_id AND running.status='PROCESSING')
       ORDER BY j.scheduled_at
       FOR UPDATE OF j,campaign,w SKIP LOCKED LIMIT 1`,
    );
    const job = result.rows[0];
    if (!job) return null;
    await client.query("UPDATE email_jobs SET status='PROCESSING',started_at=now(),attempt_count=attempt_count+1,locked_by=$1,updated_at=now() WHERE id=$2", [workerId, job.id]);
    await client.query("UPDATE contacts SET status='PROCESSING',updated_at=now() WHERE id=$1", [job.contact_id]);
    await client.query("UPDATE campaigns SET status='RUNNING',updated_at=now() WHERE id=$1 AND status='SCHEDULED'", [job.campaign_id]);
    return job;
  });
}

async function processJob(job: Job) {
  const snapshot = job.contact_snapshot || {};
  const source = { name: job.name, email: job.email, company: job.company, company_type: job.company_type, hub: job.hub, network: job.network, job_title: job.job_title, city: job.city, custom_fields: job.custom_fields, ...snapshot };
  const values = { nombre: source.name, empresa: source.company, email: source.email, tipo: source.company_type, hub: source.hub, red: source.network, cargo: source.job_title, ciudad: source.city, ...(source.custom_fields as Record<string, unknown>) };
  let subject = renderMessage(job.subject, values);
  const body = renderMessage(job.body_text, values);
  let sendAttempted = false;
  let threadId: string | undefined;
  let replyToMessageId: string | undefined;
  try {
    if (job.step_number > 0) {
      const earlier = await pool().query<ReplyCheck & { rendered_subject: string }>(`SELECT j.id,j.workspace_id,j.contact_id,j.gmail_message_id,j.gmail_thread_id,j.sent_at,j.rendered_subject,g.google_email,g.encrypted_access_token,g.encrypted_refresh_token
        FROM email_jobs j JOIN google_connections g ON g.workspace_id=j.workspace_id
        WHERE j.campaign_id=$1 AND j.contact_id=$2 AND j.status='SENT' AND j.gmail_thread_id IS NOT NULL ORDER BY j.step_number DESC`, [job.campaign_id, job.contact_id]);
      for (const previous of earlier.rows) {
        const reply = await findReplyInThread({ accessToken: previous.encrypted_access_token ? decryptSecret(previous.encrypted_access_token) : undefined,
          refreshToken: decryptSecret(previous.encrypted_refresh_token), threadId: previous.gmail_thread_id,
          sentMessageId: previous.gmail_message_id, accountEmail: previous.google_email, sentAt: previous.sent_at });
        if (reply) {
          await recordReply(previous, reply);
          await transaction(async (client) => {
            await client.query("UPDATE email_jobs SET status='CANCELLED',updated_at=now() WHERE id=$1 AND status='PROCESSING'", [job.id]);
            await client.query(`UPDATE campaigns SET status='COMPLETED',updated_at=now() WHERE id=$1 AND status='RUNNING'
              AND NOT EXISTS (SELECT 1 FROM email_jobs WHERE campaign_id=$1 AND status IN ('SCHEDULED','PROCESSING'))`, [job.campaign_id]);
          });
          return;
        }
      }
      const previous = earlier.rows[0];
      if (!previous) throw new Error("Falta el correo anterior para continuar el hilo.");
      threadId = previous.gmail_thread_id;
      subject = previous.rendered_subject;
      replyToMessageId = await getGmailRfcMessageId({ accessToken: previous.encrypted_access_token ? decryptSecret(previous.encrypted_access_token) : undefined,
        refreshToken: decryptSecret(previous.encrypted_refresh_token), messageId: previous.gmail_message_id });
    }
    const active = await pool().query("SELECT 1 FROM campaigns ca JOIN contacts co ON co.id=$2 JOIN workspaces w ON w.id=ca.workspace_id WHERE ca.id=$1 AND ca.status='RUNNING' AND co.status='PROCESSING' AND w.sending_enabled=true", [job.campaign_id, job.contact_id]);
    if (!active.rows[0]) {
      await transaction(async (client) => {
        await client.query("UPDATE email_jobs SET status='SCHEDULED',started_at=null,updated_at=now() WHERE id=$1 AND status='PROCESSING'", [job.id]);
        await client.query("UPDATE contacts SET status=$1,updated_at=now() WHERE id=$2 AND status='PROCESSING'", [job.step_number ? "SENT" : "QUEUED", job.contact_id]);
      });
      return;
    }
    sendAttempted = true;
    const sent = await sendGmailMessage({
      accessToken: job.encrypted_access_token ? decryptSecret(job.encrypted_access_token) : undefined,
      refreshToken: decryptSecret(job.encrypted_refresh_token),
      to: String(source.email),
      subject,
      body,
      senderEmail: job.google_email,
      threadId,
      replyToMessageId,
    });
    await transaction(async (client) => {
      await client.query("UPDATE email_jobs SET status='SENT',sent_at=now(),rendered_subject=$1,rendered_body=$2,gmail_message_id=$3,gmail_thread_id=$4,error_message=null,updated_at=now() WHERE id=$5", [subject, body, sent.messageId, sent.threadId, job.id]);
      const contact = await client.query<{ status: string }>("UPDATE contacts SET status=CASE WHEN status IN ('REPLIED','DO_NOT_CONTACT') THEN status ELSE 'SENT' END,last_contacted_at=now(),last_error=null,updated_at=now() WHERE id=$1 RETURNING status", [job.contact_id]);
      const next = await client.query<{ template_id: string; template_version: number; delay_days: number; subject_snapshot: string; body_snapshot: string }>(`SELECT f.template_id,COALESCE(f.template_version,t.version) AS template_version,f.delay_days,
        COALESCE(f.subject_snapshot,t.subject) AS subject_snapshot,COALESCE(f.body_snapshot,t.body_text) AS body_snapshot FROM campaign_followups f JOIN message_templates t ON t.id=f.template_id
        WHERE f.campaign_id=$1 AND f.step_number=$2`, [job.campaign_id, job.step_number + 1]);
      if (next.rows[0] && !["REPLIED", "DO_NOT_CONTACT"].includes(contact.rows[0]?.status)) await client.query(`INSERT INTO email_jobs(workspace_id,campaign_id,contact_id,template_id,template_version,subject_snapshot,body_snapshot,contact_snapshot,step_number,scheduled_at,idempotency_key)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+($10::int * interval '1 day'),$11) ON CONFLICT (campaign_id,contact_id,step_number) DO NOTHING`,
        [job.workspace_id, job.campaign_id, job.contact_id, next.rows[0].template_id, next.rows[0].template_version, next.rows[0].subject_snapshot, next.rows[0].body_snapshot, job.contact_snapshot ? JSON.stringify(job.contact_snapshot) : null, job.step_number + 1, next.rows[0].delay_days,
          crypto.createHash("sha256").update(`${job.campaign_id}:${job.contact_id}:${job.step_number + 1}`).digest("hex")]);
      await client.query("INSERT INTO audit_logs(workspace_id,action,entity_type,entity_id,metadata) VALUES($1,'EMAIL_SENT','EMAIL_JOB',$2,$3)", [job.workspace_id, job.id, JSON.stringify({ detail: `Correo enviado a ${job.email}`, gmailMessageId: sent.messageId, gmailThreadId: sent.threadId })]);
      await client.query(
        `UPDATE campaigns SET status='COMPLETED',updated_at=now()
         WHERE id=$1 AND status='RUNNING' AND NOT EXISTS (SELECT 1 FROM email_jobs WHERE campaign_id=$1 AND status IN ('SCHEDULED','PROCESSING'))`,
        [job.campaign_id],
      );
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!sendAttempted) {
      await transaction(async (client) => {
        await client.query("UPDATE email_jobs SET status='SCHEDULED',started_at=null,scheduled_at=now()+interval '15 minutes',error_message=$1,updated_at=now() WHERE id=$2", [message.slice(0, 1000), job.id]);
        await client.query("UPDATE contacts SET status='SENT',updated_at=now() WHERE id=$1 AND status='PROCESSING'", [job.contact_id]);
      });
      return;
    }
    await transaction(async (client) => {
      await client.query("UPDATE email_jobs SET status='ERROR',rendered_subject=$1,rendered_body=$2,error_message=$3,updated_at=now() WHERE id=$4", [subject, body, message.slice(0, 1000), job.id]);
      await client.query("UPDATE contacts SET status=CASE WHEN status IN ('REPLIED','DO_NOT_CONTACT') THEN status ELSE 'ERROR' END,last_error=$1,updated_at=now() WHERE id=$2", [message.slice(0, 1000), job.contact_id]);
      await client.query("INSERT INTO audit_logs(workspace_id,action,entity_type,entity_id,metadata) VALUES($1,'EMAIL_ERROR','EMAIL_JOB',$2,$3)", [job.workspace_id, job.id, JSON.stringify({ detail: `Falló el envío a ${job.email}`, error: message })]);
      await client.query(
        `UPDATE campaigns SET status='COMPLETED',updated_at=now()
         WHERE id=$1 AND status='RUNNING' AND NOT EXISTS (SELECT 1 FROM email_jobs WHERE campaign_id=$1 AND status IN ('SCHEDULED','PROCESSING'))`,
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

async function recordReply(item: ReplyCheck, reply: { messageId: string; from: string; receivedAt: Date }) {
  await transaction(async (client) => {
    const updated = await client.query("UPDATE email_jobs SET reply_message_id=$1,reply_from=$2,reply_detected_at=$3,last_reply_checked_at=now(),updated_at=now() WHERE id=$4 AND reply_detected_at IS NULL RETURNING id", [reply.messageId, reply.from, reply.receivedAt, item.id]);
    if (!updated.rows[0]) return;
    await client.query("UPDATE contacts SET status='REPLIED',updated_at=now() WHERE id=$1 AND status <> 'DO_NOT_CONTACT'", [item.contact_id]);
    await client.query("UPDATE email_jobs SET status='CANCELLED',updated_at=now() WHERE contact_id=$1 AND status='SCHEDULED'", [item.contact_id]);
    await client.query(`UPDATE campaigns c SET status='COMPLETED',updated_at=now() WHERE c.id IN
      (SELECT campaign_id FROM email_jobs WHERE contact_id=$1) AND c.status IN ('SCHEDULED','RUNNING')
      AND NOT EXISTS (SELECT 1 FROM email_jobs j WHERE j.campaign_id=c.id AND j.status IN ('SCHEDULED','PROCESSING'))`, [item.contact_id]);
    await client.query("INSERT INTO audit_logs(workspace_id,action,entity_type,entity_id,metadata) VALUES($1,'REPLY_DETECTED','EMAIL_JOB',$2,$3)", [item.workspace_id, item.id, JSON.stringify({ detail: `Respuesta detectada de ${reply.from}`, replyMessageId: reply.messageId })]);
  });
}

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
    if (reply) await recordReply(item, reply);
    else await pool().query("UPDATE email_jobs SET last_reply_checked_at=now(),updated_at=now() WHERE id=$1", [item.id]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${workerId}] no se pudo revisar el hilo ${item.gmail_thread_id}: ${message}`);
    await pool().query("UPDATE email_jobs SET last_reply_checked_at=now(),updated_at=now() WHERE id=$1", [item.id]);
  }
}

async function tick() {
  await pool().query("INSERT INTO worker_heartbeats(worker_id,last_seen_at) VALUES($1,now()) ON CONFLICT(worker_id) DO UPDATE SET last_seen_at=now()", [workerId]);
  await cleanupUnassignedContacts();
  await reconcileStuckJobs();
  await checkOneReply();
  const job = await claimJob();
  if (job) await processJob(job);
}

async function reconcileStuckJobs() {
  const stale = await pool().query<{ id: string; contact_id: string; campaign_id: string; workspace_id: string }>(
    "SELECT id,contact_id,campaign_id,workspace_id FROM email_jobs WHERE status='PROCESSING' AND started_at < now()-interval '10 minutes' LIMIT 20",
  );
  for (const job of stale.rows) {
    await transaction(async (client) => {
      const changed = await client.query("UPDATE email_jobs SET status='ERROR',error_message='Envío interrumpido: revisar Gmail antes de reintentar.',updated_at=now() WHERE id=$1 AND status='PROCESSING' RETURNING id", [job.id]);
      if (!changed.rows[0]) return;
      await client.query("UPDATE contacts SET status='ERROR',last_error='Envío interrumpido: revisar Gmail antes de reintentar.',updated_at=now() WHERE id=$1 AND status='PROCESSING'", [job.contact_id]);
      await client.query("INSERT INTO audit_logs(workspace_id,action,entity_type,entity_id,metadata) VALUES($1,'EMAIL_INTERRUPTED','EMAIL_JOB',$2,$3)", [job.workspace_id, job.id, JSON.stringify({ detail: "Envío interrumpido; se requiere revisar Gmail" })]);
      await client.query(`UPDATE campaigns SET status='COMPLETED',updated_at=now() WHERE id=$1 AND status='RUNNING'
        AND NOT EXISTS (SELECT 1 FROM email_jobs WHERE campaign_id=$1 AND status IN ('SCHEDULED','PROCESSING'))`, [job.campaign_id]);
    });
  }
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
