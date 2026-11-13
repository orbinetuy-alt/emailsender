import { NextResponse } from "next/server";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { isDemoMode, query, transaction } from "@/lib/db";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    if (isDemoMode()) return NextResponse.json({ error: "No disponible en modo demo." }, { status: 409 });
    const { id } = await context.params;
    const campaign = await query(`SELECT c.id,c.name,c.status,c.start_at AS "startAt",c.interval_minutes AS "intervalMinutes",c.filters,
      t.name AS "templateName" FROM campaigns c JOIN message_templates t ON t.id=c.template_id
      WHERE c.id=$1 AND c.workspace_id=$2`, [id, viewer.workspaceId]);
    if (!campaign.rows[0]) return NextResponse.json({ error: "Campaña no encontrada." }, { status: 404 });
    const [recipients, followups] = await Promise.all([
      query(`SELECT co.id AS "contactId",co.name,co.email,co.company,co.status AS "contactStatus",
        MAX(j.sent_at) AS "lastSentAt",MIN(j.scheduled_at) FILTER (WHERE j.status='SCHEDULED') AS "nextAt",
        COUNT(j.id) FILTER (WHERE j.status='SENT')::int AS "sentCount",
        COUNT(j.id) FILTER (WHERE j.status='ERROR')::int AS "errorCount",
        COUNT(j.id) FILTER (WHERE j.status='CANCELLED')::int AS "cancelledCount",
        BOOL_OR(j.reply_detected_at IS NOT NULL) AS replied,
        MAX(j.reply_detected_at) AS "repliedAt",MAX(j.error_message) FILTER (WHERE j.status='ERROR') AS "lastError",
        json_agg(json_build_object('step',j.step_number,'status',j.status,'scheduledAt',j.scheduled_at,'sentAt',j.sent_at,'replyAt',j.reply_detected_at,'error',j.error_message) ORDER BY j.step_number) AS history
        FROM email_jobs j JOIN contacts co ON co.id=j.contact_id WHERE j.campaign_id=$1 AND j.workspace_id=$2
        GROUP BY co.id ORDER BY co.name LIMIT 5000`, [id, viewer.workspaceId]),
      query(`SELECT f.step_number AS "step",f.delay_days AS "delayDays",t.name AS "templateName" FROM campaign_followups f
        JOIN message_templates t ON t.id=f.template_id WHERE f.campaign_id=$1 ORDER BY f.step_number`, [id]),
    ]);
    return NextResponse.json({ campaign: campaign.rows[0], recipients: recipients.rows, followups: followups.rows });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 400 });
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    if (isDemoMode()) return NextResponse.json({ error: "No disponible en modo demo." }, { status: 409 });
    const { id } = await context.params;
    const { action } = z.object({ action: z.enum(["pause", "resume", "cancel"]) }).parse(await request.json());
    const result = await transaction(async (client) => {
      const found = await client.query<{ status: string }>("SELECT status FROM campaigns WHERE id=$1 AND workspace_id=$2 FOR UPDATE", [id, viewer.workspaceId]);
      const current = found.rows[0]?.status;
      if (!current) throw new Error("Campaña no encontrada.");
      if (action === "pause" && !["SCHEDULED", "RUNNING"].includes(current)) throw new Error("Esta campaña no puede pausarse.");
      if (action === "resume" && current !== "PAUSED") throw new Error("Esta campaña no está pausada.");
      if (action === "cancel" && !["SCHEDULED", "RUNNING", "PAUSED"].includes(current)) throw new Error("Esta campaña no puede cancelarse.");
      const status = action === "pause" ? "PAUSED" : action === "resume" ? "RUNNING" : "CANCELLED";
      await client.query("UPDATE campaigns SET status=$1,updated_at=now() WHERE id=$2", [status, id]);
      if (action === "cancel") {
        await client.query("UPDATE email_jobs SET status='CANCELLED',updated_at=now() WHERE campaign_id=$1 AND status='SCHEDULED'", [id]);
        await client.query(`UPDATE contacts c SET status='READY',updated_at=now() WHERE status='QUEUED' AND EXISTS
          (SELECT 1 FROM email_jobs j WHERE j.contact_id=c.id AND j.campaign_id=$1) AND NOT EXISTS
          (SELECT 1 FROM email_jobs j WHERE j.contact_id=c.id AND j.status IN ('SCHEDULED','PROCESSING','SENT'))`, [id]);
      }
      await client.query("INSERT INTO audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,'CAMPAIGN',$4,$5)", [viewer.workspaceId, viewer.userId, `CAMPAIGN_${status}`, id, JSON.stringify({ detail: `Campaña ${status.toLowerCase()}` })]);
      return { status };
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    if (isDemoMode()) return NextResponse.json({ error: "No disponible en modo demo." }, { status: 409 });
    const { id } = await context.params;
    const deleted = await transaction(async (client) => {
      const campaign = await client.query<{ status: string }>("SELECT status FROM campaigns WHERE id=$1 AND workspace_id=$2 FOR UPDATE", [id, viewer.workspaceId]);
      if (!campaign.rows[0]) throw new Error("Campaña no encontrada.");
      if (campaign.rows[0].status !== "CANCELLED" && campaign.rows[0].status !== "COMPLETED") {
        throw new Error("Cancelá o terminá la campaña antes de eliminarla.");
      }
      const processing = await client.query("SELECT 1 FROM email_jobs WHERE campaign_id=$1 AND status='PROCESSING' LIMIT 1", [id]);
      if (processing.rows[0]) throw new Error("Esperá a que termine el envío en curso.");
      const contacts = await client.query<{ contact_id: string }>("SELECT DISTINCT contact_id FROM email_jobs WHERE campaign_id=$1", [id]);
      await client.query("DELETE FROM campaigns WHERE id=$1", [id]);
      if (contacts.rows.length) {
        const ids = contacts.rows.map((item) => item.contact_id);
        await client.query(`DELETE FROM contact_import_items ii WHERE ii.contact_id=ANY($1::uuid[])
          AND NOT EXISTS (SELECT 1 FROM email_jobs j WHERE j.contact_id=ii.contact_id)`, [ids]);
        await client.query(`DELETE FROM contacts c WHERE c.id=ANY($1::uuid[])
          AND NOT EXISTS (SELECT 1 FROM email_jobs j WHERE j.contact_id=c.id)
          AND NOT EXISTS (SELECT 1 FROM contact_import_items ii WHERE ii.contact_id=c.id)`, [ids]);
      }
      await client.query(`DELETE FROM contact_imports ci WHERE ci.workspace_id=$1 AND NOT EXISTS
        (SELECT 1 FROM contact_import_items ii WHERE ii.import_id=ci.id)`, [viewer.workspaceId]);
      await client.query("INSERT INTO audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'CAMPAIGN_DELETED','CAMPAIGN',$3,$4)", [viewer.workspaceId, viewer.userId, id, JSON.stringify({ detail: "Campaña y destinatarios exclusivos eliminados", contacts: contacts.rows.length })]);
      return { deleted: true, contactsConsidered: contacts.rows.length };
    });
    return NextResponse.json(deleted);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 400 });
  }
}
