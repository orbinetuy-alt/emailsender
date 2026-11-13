import { NextResponse } from "next/server";
import { requireViewer } from "@/lib/auth";
import { campaignFiltersSchema, contactFilterSql } from "@/lib/campaign-filters";
import { isDemoMode, query } from "@/lib/db";
import { renderMessage } from "@/lib/google";
import { z } from "zod";

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    if (isDemoMode()) return NextResponse.json({ count: 0 });
    const input = campaignFiltersSchema.extend({ templateId: z.string().uuid().optional() }).parse(await request.json());
    const { templateId, ...filters } = input;
    const filtered = contactFilterSql(viewer.workspaceId, filters);
    const [result, recipients, template] = await Promise.all([
      query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM contacts c WHERE ${filtered.where}`, filtered.values),
      query<{ name: string; email: string; company: string; company_type: string; hub: string; network: string; job_title: string; city: string; custom_fields: Record<string, unknown> }>(`SELECT c.name,c.email,c.company,c.company_type,c.hub,c.network,c.job_title,c.city,c.custom_fields FROM contacts c WHERE ${filtered.where} ORDER BY c.created_at,c.id LIMIT 5000`, filtered.values),
      templateId ? query<{ subject: string; body_text: string }>("SELECT subject,body_text FROM message_templates WHERE id=$1 AND workspace_id=$2 AND active=true", [templateId, viewer.workspaceId]) : Promise.resolve({ rows: [] }),
    ]);
    const first = recipients.rows[0];
    const selected = template.rows[0];
    const values = first ? { nombre: first.name, empresa: first.company, email: first.email, tipo: first.company_type, hub: first.hub, red: first.network, cargo: first.job_title, ciudad: first.city, ...first.custom_fields } : {};
    return NextResponse.json({ count: result.rows[0]?.count ?? 0, recipients: recipients.rows.map(({ name, email, company }) => ({ name, email, company })),
      sample: first && selected ? { to: first.email, subject: renderMessage(selected.subject, values), body: renderMessage(selected.body_text, values) } : null });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 400 });
  }
}
