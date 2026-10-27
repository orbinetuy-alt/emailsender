import { pool, transaction } from "../lib/db";
import { ensureWorkspaceDefaults } from "../lib/workspace-defaults";

async function main() {
  const workspaces = await pool().query<{ id: string }>("SELECT id FROM workspaces");

  await transaction(async (client) => {
    for (const workspace of workspaces.rows) {
      await ensureWorkspaceDefaults(client, workspace.id);
    }
  });

  console.log(`Plantillas predeterminadas verificadas en ${workspaces.rowCount ?? 0} espacio(s).`);
  await pool().end();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await pool().end();
  process.exitCode = 1;
});
