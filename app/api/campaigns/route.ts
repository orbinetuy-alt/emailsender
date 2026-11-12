import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { isDemoMode, transaction } from "@/lib/db";
import { campaignFiltersSchema, contactFilterSql } from "@/lib/campaign-filters";

const schema = z.object({
  name: z.string().min(1).max(160),
  templateId: z.string().uuid(),
  filters: campaignFiltersSchema,
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
      const template = await client.query<{ id: string; version: number }>(
        "SELECT id,version FROM message_templates WHERE id=$1 AND workspace_id=$2 AND active=true",
        [input.templateId, viewer.workspaceId],
      );
      if (!template.rows[0]) throw new Error("La plantilla seleccionada no está disponible.");
      if (input.filters.importId) {
        const source = await client.query("SELECT 1 FROM contact_imports WHERE id=$1 AND workspace_id=$2", [input.filters.importId, viewer.workspaceId]);
        if (!source.rows[0]) throw new Error("La lista seleccionada no existe en este espacio.");
      }
      const filtered = contactFilterSql(viewer.workspaceId, input.filters);
      const contacts = await client.query<{ id: string }>(
        `SELECT c.id FROM contacts c WHERE ${filtered.where} ORDER BY c.created_at,c.id`,
        filtered.values,
      );
      if (!contacts.rows.length) throw new Error("Los filtros no tienen contactos elegibles.");
      const campaign = await client.query<{ id: string }>(
        `INSERT INTO campaigns(workspace_id,name,status,start_at,interval_minutes,created_by,template_id,filters)
         VALUES($1,$2,'SCHEDULED',$3,$4,$5,$6,$7) RETURNING id`,
        [viewer.workspaceId, input.name, startAt, input.intervalMinutes, viewer.userId, input.templateId, JSON.stringify(input.filters)],
      );
      const campaignId = campaign.rows[0].id;
      for (const [index, contact] of contacts.rows.entries()) {
        const scheduledAt = new Date(startAt.getTime() + index * input.intervalMinutes * 60_000);
        await client.query(
          `INSERT INTO email_jobs(workspace_id,campaign_id,contact_id,template_id,template_version,scheduled_at,idempotency_key)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [viewer.workspaceId, campaignId, contact.id, template.rows[0].id, template.rows[0].version, scheduledAt, crypto.createHash("sha256").update(`${campaignId}:${contact.id}`).digest("hex")],
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
