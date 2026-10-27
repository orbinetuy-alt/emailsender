import { NextResponse } from "next/server";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { isDemoMode, query } from "@/lib/db";
import { setDemoSending } from "@/lib/demo-store";

const schema = z.object({ enabled: z.boolean(), confirmation: z.string().optional() });

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    const input = schema.parse(await request.json());
    if (input.enabled && input.confirmation !== "HABILITAR") {
      return NextResponse.json({ error: "Se requiere confirmación explícita." }, { status: 400 });
    }
    if (isDemoMode()) setDemoSending(input.enabled);
    else {
      await query("UPDATE workspaces SET sending_enabled = $1, updated_at = now() WHERE id = $2", [input.enabled, viewer.workspaceId]);
      await query("INSERT INTO audit_logs(workspace_id, actor_user_id, action, entity_type, metadata) VALUES ($1,$2,$3,'WORKSPACE',$4)", [viewer.workspaceId, viewer.userId, input.enabled ? "SENDING_ENABLED" : "SENDING_DISABLED", JSON.stringify({ detail: input.enabled ? "Se habilitaron los envíos" : "Se pausaron todos los envíos" })]);
    }
    return NextResponse.json({ enabled: input.enabled });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 400 });
  }
}
