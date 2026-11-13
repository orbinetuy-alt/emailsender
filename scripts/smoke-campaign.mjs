import pg from "pg";
import crypto from "node:crypto";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL no está configurada.");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
let workspaceId;
try {
  const workspace = await db.query("INSERT INTO workspaces(name) VALUES('Prueba temporal de campaña') RETURNING id");
  workspaceId = workspace.rows[0].id;
  const user = await db.query("INSERT INTO users(workspace_id,email,name) VALUES($1,$2,'Prueba') RETURNING id", [workspaceId, `test-${crypto.randomUUID()}@example.invalid`]);
  const token = crypto.randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')", [user.rows[0].id, crypto.createHash("sha256").update(token).digest("hex")]);
  const first = await db.query("INSERT INTO message_templates(workspace_id,code,name,subject,body_text) VALUES($1,'TEST_INITIAL','Inicial','Hola {{nombre}}','Mensaje inicial') RETURNING id", [workspaceId]);
  const follow = await db.query("INSERT INTO message_templates(workspace_id,code,name,subject,body_text) VALUES($1,'TEST_FOLLOW','Seguimiento','Re: Hola','Mensaje de seguimiento') RETURNING id", [workspaceId]);
  await db.query("INSERT INTO contacts(workspace_id,name,email,company_type,status) VALUES($1,'Prueba','prueba@example.invalid','Fintech','READY')", [workspaceId]);

  const call = async (path, method = "GET", body) => {
    const response = await fetch(`${process.env.APP_URL || "http://localhost:3000"}${path}`, {
      method,
      headers: { Cookie: `outreach_session=${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
    return data;
  };
  const filters = { importId: null, importScope: "new", types: [], hubs: [], companies: [], networks: [], emailQualities: [], excludeExistingClients: true };
  const newTemplate = await call("/api/templates", "POST", { name: "Creada desde la API", subject: "Hola", body: "Texto" });
  if (!newTemplate.id) throw new Error("No se creó la plantilla.");
  const preview = await call("/api/campaigns/preview", "POST", filters);
  if (preview.count !== 1) throw new Error(`Vista previa incorrecta: ${preview.count}`);
  const created = await call("/api/campaigns", "POST", { name: "Prueba aislada", templateId: first.rows[0].id, filters, intervalMinutes: 5, followups: [{ delayDays: 5, templateId: follow.rows[0].id }] });
  await call(`/api/templates/${first.rows[0].id}`, "PUT", { name: "Inicial editada", subject: "Asunto nuevo", body: "Texto nuevo", active: true });
  const snapshots = await db.query("SELECT subject_snapshot,body_snapshot FROM email_jobs WHERE campaign_id=$1", [created.id]);
  if (snapshots.rows[0]?.subject_snapshot !== "Hola {{nombre}}" || snapshots.rows[0]?.body_snapshot !== "Mensaje inicial") throw new Error("La campaña cambió al editar la plantilla.");
  const followupSnapshot = await db.query("SELECT body_snapshot FROM campaign_followups WHERE campaign_id=$1", [created.id]);
  if (followupSnapshot.rows[0]?.body_snapshot !== "Mensaje de seguimiento") throw new Error("El seguimiento no guardó su contenido.");
  const detail = await call(`/api/campaigns/${created.id}`);
  if (detail.recipients.length !== 1 || detail.followups.length !== 1) throw new Error("Detalle incorrecto.");
  await call(`/api/campaigns/${created.id}`, "PATCH", { action: "pause" });
  await call(`/api/campaigns/${created.id}`, "PATCH", { action: "resume" });
  await call(`/api/campaigns/${created.id}`, "PATCH", { action: "cancel" });
  await call(`/api/campaigns/${created.id}`, "DELETE");
  const remaining = await db.query("SELECT count(*)::int AS total FROM contacts WHERE workspace_id=$1", [workspaceId]);
  if (remaining.rows[0].total !== 0) throw new Error("La campaña eliminada dejó destinatarios exclusivos.");
  console.log("OK: vista previa, creación, plantillas congeladas, detalle, pausa, reanudación, cancelación y eliminación.");
} finally {
  if (workspaceId) await db.query("DELETE FROM workspaces WHERE id=$1", [workspaceId]);
  await db.end();
}
