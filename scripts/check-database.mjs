import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL no está configurada.");

const expected = ["audit_logs", "campaigns", "contacts", "email_jobs", "google_connections", "message_templates", "sessions", "users", "workspaces"];
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
});

await client.connect();
try {
  const result = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
  const actual = result.rows.map((row) => row.table_name);
  const missing = expected.filter((name) => !actual.includes(name));
  if (missing.length) throw new Error(`Faltan tablas: ${missing.join(", ")}`);
  const counts = await client.query("SELECT (SELECT count(*)::int FROM workspaces) AS workspaces,(SELECT count(*)::int FROM contacts) AS contacts,(SELECT count(*)::int FROM email_jobs) AS jobs");
  console.log(JSON.stringify({ status: "ok", tables: actual.length, rows: counts.rows[0] }, null, 2));
} finally {
  await client.end();
}
