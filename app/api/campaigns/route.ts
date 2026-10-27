import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { isDemoMode, transaction } from "@/lib/db";

const schema = z.object({
  name: z.string().min(1).max(160),
  contactIds: z.array(z.string().uuid()).min(1),
  startAt: z.string().datetime().optional(),
  intervalMinutes: z.number().int().min(1).max(1440).default(5),
});

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    if (isDemoMode()) return NextResponse.json({ error: "La programación real está deshabilitada en modo demo." }, { status: 409 });
    const input = schema.parse(await request.json());
    const startAt = input.startAt ? new Date(input.startAt) : new Date();
    const result = await transaction(async (client) => {
      const campaign = await client.query<{ id: string }>(
        `INSERT INTO campaigns(workspace_id,name,status,start_at,interval_minutes,created_by)
         VALUES($1,$2,'SCHEDULED',$3,$4,$5) RETURNING id`,
        [viewer.workspaceId, input.name, startAt, input.intervalMinutes, viewer.userId],
      );
      const campaignId = campaign.rows[0].id;
      const contacts = await client.query<{ id: string; company_type: string; template_id: string; version: number }>(
        `SELECT c.id,c.company_type,t.id AS template_id,t.version
         FROM contacts c JOIN message_templates t ON t.workspace_id=c.workspace_id AND t.code=c.company_type AND t.active=true
         WHERE c.workspace_id=$1 AND c.id=ANY($2::uuid[]) AND c.status IN ('DRAFT','READY','ERROR')`,
        [viewer.workspaceId, input.contactIds],
      );
      if (!contacts.rows.length) throw new Error("No hay contactos elegibles con una plantilla activa.");
      for (const [index, contact] of contacts.rows.entries()) {
        const scheduledAt = new Date(startAt.getTime() + index * input.intervalMinutes * 60_000);
        await client.query(
          `INSERT INTO email_jobs(workspace_id,campaign_id,contact_id,template_id,template_version,scheduled_at,idempotency_key)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [viewer.workspaceId, campaignId, contact.id, contact.template_id, contact.version, scheduledAt, crypto.createHash("sha256").update(`${campaignId}:${contact.id}`).digest("hex")],
        );
        await client.query("UPDATE contacts SET status='QUEUED',updated_at=now() WHERE id=$1", [contact.id]);
      }
      await client.query("INSERT INTO audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'CAMPAIGN_SCHEDULED','CAMPAIGN',$3,$4)", [viewer.workspaceId, viewer.userId, campaignId, JSON.stringify({ detail: `Campaña ${input.name} programada`, contacts: contacts.rows.length })]);
      return { id: campaignId, scheduled: contacts.rows.length };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 400 });
  }
}
