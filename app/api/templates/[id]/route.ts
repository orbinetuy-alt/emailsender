import { NextResponse } from "next/server";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { isDemoMode, query } from "@/lib/db";
import { updateDemoTemplate } from "@/lib/demo-store";

const schema = z.object({ name: z.string().min(1).max(120), subject: z.string().min(1).max(250), body: z.string().min(1).max(20000), active: z.boolean() });

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requireViewer();
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    if (isDemoMode()) return NextResponse.json(updateDemoTemplate(id, input));
    const result = await query(
      `UPDATE message_templates SET name=$1, subject=$2, body_text=$3, active=$4, version=version+1, updated_at=now()
       WHERE id=$5 AND workspace_id=$6 RETURNING id, code, name, subject, body_text AS body, active, version`,
      [input.name, input.subject, input.body, input.active, id, viewer.workspaceId],
    );
    if (!result.rows[0]) return NextResponse.json({ error: "Plantilla no encontrada." }, { status: 404 });
    return NextResponse.json(result.rows[0]);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 400 });
  }
}
