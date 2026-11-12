import { NextResponse } from "next/server";
import { requireViewer } from "@/lib/auth";
import { campaignFiltersSchema, contactFilterSql } from "@/lib/campaign-filters";
import { isDemoMode, query } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    if (isDemoMode()) return NextResponse.json({ count: 0 });
    const filters = campaignFiltersSchema.parse(await request.json());
    const filtered = contactFilterSql(viewer.workspaceId, filters);
    const [result, recipients] = await Promise.all([
      query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM contacts c WHERE ${filtered.where}`, filtered.values),
      query<{ name: string; email: string; company: string }>(`SELECT c.name,c.email,c.company FROM contacts c WHERE ${filtered.where} ORDER BY c.created_at,c.id LIMIT 5000`, filtered.values),
    ]);
    return NextResponse.json({ count: result.rows[0]?.count ?? 0, recipients: recipients.rows });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 400 });
  }
}
