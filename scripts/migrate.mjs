import { readFile } from "node:fs/promises";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL no está configurada.");

const sql = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
});

await client.connect();
try {
  await client.query(sql);
  console.log("Esquema aplicado correctamente.");
} finally {
  await client.end();
}
