import { demoDashboard } from "@/lib/demo-store";
import { isDemoMode, query } from "@/lib/db";

export async function getDashboard(workspaceId: string) {
  if (isDemoMode()) return demoDashboard();
  const [workspace, contacts, templates, campaigns, activity, imports, worker, connection] = await Promise.all([
    query<{ sending_enabled: boolean }>("SELECT sending_enabled FROM workspaces WHERE id = $1", [workspaceId]),
    query(`SELECT id,name,company,email,company_type AS "companyType",hub,network,job_title AS "jobTitle",city,
      email_quality AS "emailQuality",existing_client_office AS "existingClientOffice",status,last_error AS "lastError",updated_at AS "updatedAt"
      FROM contacts c WHERE workspace_id = $1 AND NOT EXISTS
      (SELECT 1 FROM email_jobs j WHERE j.contact_id=c.id) ORDER BY updated_at DESC LIMIT 5000`, [workspaceId]),
    query(`SELECT id, code, name, subject, body_text AS body, active, version FROM message_templates WHERE workspace_id = $1 ORDER BY code`, [workspaceId]),
    query(`SELECT c.id,c.name,c.status,c.start_at AS "startAt",c.filters,t.name AS "templateName",
      COUNT(DISTINCT j.contact_id) FILTER (WHERE j.step_number=0)::int AS total,
      COUNT(DISTINCT j.contact_id) FILTER (WHERE j.status = 'SENT')::int AS sent,
      COUNT(DISTINCT j.contact_id) FILTER (WHERE j.reply_detected_at IS NOT NULL)::int AS replied,
      COUNT(DISTINCT j.contact_id) FILTER (WHERE j.status = 'ERROR')::int AS errors,
      MIN(j.scheduled_at) FILTER (WHERE j.status='SCHEDULED') AS "nextAt"
      FROM campaigns c LEFT JOIN email_jobs j ON j.campaign_id=c.id LEFT JOIN message_templates t ON t.id=c.template_id
      WHERE c.workspace_id=$1 GROUP BY c.id,t.name ORDER BY c.created_at DESC`, [workspaceId]),
    query(`SELECT id::text, action, COALESCE(metadata->>'detail', entity_type) AS detail, created_at AS "createdAt" FROM audit_logs WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 30`, [workspaceId]),
    query(`SELECT id,file_name AS "fileName",total_rows AS total,created_count AS created,updated_count AS updated,rejected_count AS rejected,
      created_at AS "createdAt" FROM contact_imports WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 10`, [workspaceId]),
    query<{ online: boolean }>("SELECT EXISTS(SELECT 1 FROM worker_heartbeats WHERE last_seen_at > now()-interval '60 seconds') AS online"),
    query<{ google_email: string }>("SELECT google_email FROM google_connections WHERE workspace_id=$1 AND encrypted_refresh_token IS NOT NULL", [workspaceId]),
  ]);
  return {
    connected: Boolean(connection.rows[0]),
    connectedEmail: connection.rows[0]?.google_email ?? null,
    sendingEnabled: workspace.rows[0]?.sending_enabled ?? false,
    workerOnline: worker.rows[0]?.online ?? false,
    contacts: contacts.rows,
    templates: templates.rows,
    campaigns: campaigns.rows,
    activity: activity.rows,
    imports: imports.rows,
    filterOptions: {
      types: [...new Set(contacts.rows.map((item: any) => item.companyType).filter(Boolean))].sort(),
      hubs: [...new Set(contacts.rows.map((item: any) => item.hub).filter(Boolean))].sort(),
      companies: [...new Set(contacts.rows.map((item: any) => item.company).filter(Boolean))].sort(),
      networks: [...new Set(contacts.rows.map((item: any) => item.network).filter(Boolean))].sort(),
      emailQualities: [...new Set(contacts.rows.map((item: any) => item.emailQuality).filter(Boolean))].sort(),
    },
  };
}
