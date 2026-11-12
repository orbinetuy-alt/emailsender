import { NextResponse } from "next/server";
import { requireViewer } from "@/lib/auth";
import { isDemoMode, transaction } from "@/lib/db";

export async function PATCH(_request: Request, context: { params: Promise<{ id: string; contactId: string }> }) {
  try {
    const viewer = await requireViewer();
    if (isDemoMode()) return NextResponse.json({ error: "No disponible en modo demo." }, { status: 409 });
    const { id, contactId } = await context.params;
    await transaction(async (client) => {
      const exists = await client.query("SELECT 1 FROM campaigns WHERE id=$1 AND workspace_id=$2", [id, viewer.workspaceId]);
      if (!exists.rows[0]) throw new Error("Campaña no encontrada.");
      await client.query("UPDATE email_jobs SET status='CANCELLED',updated_at=now() WHERE campaign_id=$1 AND contact_id=$2 AND status='SCHEDULED'", [id, contactId]);
      await client.query(`UPDATE contacts c SET status='READY',updated_at=now() WHERE c.id=$1 AND c.workspace_id=$2 AND c.status='QUEUED'
        AND NOT EXISTS (SELECT 1 FROM email_jobs j WHERE j.contact_id=c.id AND j.status IN ('SCHEDULED','PROCESSING','SENT'))`, [contactId, viewer.workspaceId]);
      await client.query("INSERT INTO audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'CAMPAIGN_RECIPIENT_EXCLUDED','CONTACT',$3,$4)", [viewer.workspaceId, viewer.userId, contactId, JSON.stringify({ detail: "Contacto excluido de campaña", campaignId: id })]);
      await client.query(`UPDATE campaigns SET status='COMPLETED',updated_at=now() WHERE id=$1 AND status IN ('SCHEDULED','RUNNING')
        AND NOT EXISTS (SELECT 1 FROM email_jobs WHERE campaign_id=$1 AND status IN ('SCHEDULED','PROCESSING'))`, [id]);
    });
    return NextResponse.json({ excluded: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status: 400 });
  }
}
