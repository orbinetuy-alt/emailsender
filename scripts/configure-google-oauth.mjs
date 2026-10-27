import crypto from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const credentialPath = process.argv[2];
if (!credentialPath) throw new Error("Uso: npm run oauth:configure -- /ruta/client_secret.json");

const credential = JSON.parse(await readFile(path.resolve(credentialPath), "utf8"));
const web = credential.web;
if (!web?.client_id || !web?.client_secret) throw new Error("El JSON no contiene una credencial OAuth de tipo Web application.");

const requiredRedirect = "http://localhost:3000/api/google/callback";
if (!Array.isArray(web.redirect_uris) || !web.redirect_uris.includes(requiredRedirect)) {
  throw new Error(`El cliente OAuth no contiene el redirect requerido: ${requiredRedirect}`);
}

const envPath = path.resolve(".env.local");
const current = await readFile(envPath, "utf8");
const entries = new Map();
for (const line of current.split(/\r?\n/)) {
  if (!line || line.trimStart().startsWith("#") || !line.includes("=")) continue;
  const index = line.indexOf("=");
  entries.set(line.slice(0, index), line.slice(index + 1));
}

entries.set("DATABASE_URL", entries.get("DATABASE_URL") || "postgresql://manuelquartino@localhost:5432/emailsender_dev");
entries.set("APP_URL", "http://localhost:3000");
entries.set("DEMO_MODE", "false");
entries.set("WORKER_POLL_INTERVAL_MS", entries.get("WORKER_POLL_INTERVAL_MS") || "15000");
entries.set("GOOGLE_CLIENT_ID", web.client_id);
entries.set("GOOGLE_CLIENT_SECRET", web.client_secret);
entries.set("GOOGLE_ALLOWED_EMAIL", entries.get("GOOGLE_ALLOWED_EMAIL") || "");
entries.set("TOKEN_ENCRYPTION_KEY", entries.get("TOKEN_ENCRYPTION_KEY") || crypto.randomBytes(32).toString("hex"));

const order = ["DATABASE_URL", "APP_URL", "DEMO_MODE", "WORKER_POLL_INTERVAL_MS", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_ALLOWED_EMAIL", "TOKEN_ENCRYPTION_KEY"];
const output = order.map((key) => `${key}=${entries.get(key) || ""}`).join("\n") + "\n";
await writeFile(envPath, output, { mode: 0o600 });
await chmod(envPath, 0o600);

console.log(JSON.stringify({
  configured: true,
  credentialType: "web",
  redirectUriVerified: true,
  allowedEmailConfigured: Boolean(entries.get("GOOGLE_ALLOWED_EMAIL")),
  encryptionKeyConfigured: true,
}, null, 2));
