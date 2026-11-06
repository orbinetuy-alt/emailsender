import { z } from "zod";

export const campaignFiltersSchema = z.object({
  types: z.array(z.string().max(200)).max(100).default([]),
  hubs: z.array(z.string().max(200)).max(100).default([]),
  companies: z.array(z.string().max(200)).max(200).default([]),
  networks: z.array(z.string().max(200)).max(200).default([]),
  emailQualities: z.array(z.string().max(200)).max(20).default([]),
  excludeExistingClients: z.boolean().default(true),
});

export type CampaignFilters = z.infer<typeof campaignFiltersSchema>;

export function contactFilterSql(workspaceId: string, filters: CampaignFilters) {
  const values: unknown[] = [workspaceId];
  const clauses = ["c.workspace_id=$1", "c.status IN ('DRAFT','READY','ERROR')"];
  const addArray = (column: string, selection: string[]) => {
    if (!selection.length) return;
    values.push(selection);
    clauses.push(`${column}=ANY($${values.length}::text[])`);
  };
  addArray("c.company_type", filters.types);
  addArray("c.hub", filters.hubs);
  addArray("c.company", filters.companies);
  addArray("c.network", filters.networks);
  addArray("c.email_quality", filters.emailQualities);
  if (filters.excludeExistingClients) clauses.push("COALESCE(c.existing_client_office,'') NOT IN ('Sí','Si','SI','SÍ')");
  return { where: clauses.join(" AND "), values };
}
