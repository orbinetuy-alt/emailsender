import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { isDemoMode, query } from "@/lib/db";

const schema = z.object({ name: z.string().trim().min(1).max(120), subject: z.string().trim().min(1).max(250), body: z.string().trim().min(1).max(20000) });

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    if (isDemoMode()) return NextResponse.json({ error: "No disponible en modo demo." }, { status: 409 });
    const input = schema.parse(await request.json());
    const code = `CUSTOM_${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    const created = await query(`INSERT INTO message_templates(workspace_id,code,name,subject,body_text)
      VALUES($1,$2,$3,$4,$5) RETURNING id,code,name,subject,body_text AS body,active,version`,
      [viewer.workspaceId, code, input.name, input.subject, input.body]);
    return NextResponse.json(created.rows[0], { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 400 });
  }
}
