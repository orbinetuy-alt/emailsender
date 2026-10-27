import { Pool, type PoolClient, type QueryResultRow } from "pg";

const globalForDb = globalThis as unknown as { outreachPool?: Pool };

export function isDemoMode() {
  return process.env.DEMO_MODE !== "false" || !process.env.DATABASE_URL;
}

export function pool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL no está configurada.");
  if (!globalForDb.outreachPool) {
    globalForDb.outreachPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
    });
  }
  return globalForDb.outreachPool;
}

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return pool().query<T>(text, values);
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
