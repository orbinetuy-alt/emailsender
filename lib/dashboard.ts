import { demoDashboard } from "@/lib/demo-store";
import { isDemoMode, query } from "@/lib/db";

export async function getDashboard(workspaceId: string) {
  if (isDemoMode()) return demoDashboard();
  const [workspace, contacts, templates, campaigns, activity] = await Promise.all([
    query<{ sending_enabled: boolean }>("SELECT sending_enabled FROM workspaces WHERE id = $1", [workspaceId]),
    query(`SELECT id, name, company, email, company_type AS "companyType", status, last_error AS "lastError", updated_at AS "updatedAt" FROM contacts WHERE workspace_id = $1 ORDER BY updated_at DESC LIMIT 1000`, [workspaceId]),
    query(`SELECT id, code, name, subject, body_text AS body, active, version FROM message_templates WHERE workspace_id = $1 ORDER BY code`, [workspaceId]),
    query(`SELECT c.id, c.name, c.status, c.start_at AS "startAt", COUNT(j.id)::int AS total, COUNT(j.id) FILTER (WHERE j.status = 'SENT')::int AS sent, COUNT(j.id) FILTER (WHERE j.status = 'ERROR')::int AS errors FROM campaigns c LEFT JOIN email_jobs j ON j.campaign_id = c.id WHERE c.workspace_id = $1 GROUP BY c.id ORDER BY c.created_at DESC`, [workspaceId]),
    query(`SELECT id::text, action, COALESCE(metadata->>'detail', entity_type) AS detail, created_at AS "createdAt" FROM audit_logs WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 30`, [workspaceId]),
  ]);
  return {
    connected: true,
    sendingEnabled: workspace.rows[0]?.sending_enabled ?? false,
    contacts: contacts.rows,
    templates: templates.rows,
    campaigns: campaigns.rows,
    activity: activity.rows,
  };
}
