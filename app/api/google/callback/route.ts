import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { google } from "googleapis";
import { encryptSecret, hashToken, randomToken } from "@/lib/crypto";
import { googleOAuthClient, GOOGLE_SCOPES } from "@/lib/google";
import { query, transaction } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  if (!code || !state || state !== cookieStore.get("google_oauth_state")?.value) {
    return NextResponse.json({ error: "Estado OAuth inválido." }, { status: 400 });
  }
  const oauth = googleOAuthClient();
  const { tokens } = await oauth.getToken(code);
  oauth.setCredentials(tokens);
  const userInfo = await google.oauth2({ version: "v2", auth: oauth }).userinfo.get();
  const email = userInfo.data.email?.toLowerCase();
  if (!email) return NextResponse.json({ error: "Google no devolvió el email." }, { status: 400 });
  const allowed = process.env.GOOGLE_ALLOWED_EMAIL?.toLowerCase();
  if (allowed && email !== allowed) return NextResponse.json({ error: "Esta cuenta no está autorizada." }, { status: 403 });
  const sessionToken = randomToken();

  await transaction(async (client) => {
    let user = await client.query<{ id: string; workspace_id: string }>("SELECT id, workspace_id FROM users WHERE email=$1", [email]);
    if (!user.rows[0]) {
      const workspace = await client.query<{ id: string }>("INSERT INTO workspaces(name) VALUES($1) RETURNING id", [userInfo.data.name ? `Espacio de ${userInfo.data.name}` : "Mi empresa"]);
      user = await client.query("INSERT INTO users(workspace_id,email,name,role) VALUES($1,$2,$3,'OWNER') RETURNING id,workspace_id", [workspace.rows[0].id, email, userInfo.data.name]);
    }
    const current = user.rows[0];
    await client.query(
      `INSERT INTO google_connections(workspace_id,google_email,encrypted_access_token,encrypted_refresh_token,token_expiry,scopes)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(workspace_id) DO UPDATE SET google_email=EXCLUDED.google_email,
       encrypted_access_token=EXCLUDED.encrypted_access_token,
       encrypted_refresh_token=COALESCE(EXCLUDED.encrypted_refresh_token,google_connections.encrypted_refresh_token),
       token_expiry=EXCLUDED.token_expiry, scopes=EXCLUDED.scopes, updated_at=now()`,
      [current.workspace_id, email, tokens.access_token ? encryptSecret(tokens.access_token) : null, tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null, tokens.expiry_date ? new Date(tokens.expiry_date) : null, tokens.scope?.split(" ") || GOOGLE_SCOPES],
    );
    await client.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 days')", [current.id, hashToken(sessionToken)]);
  });

  cookieStore.delete("google_oauth_state");
  cookieStore.set(SESSION_COOKIE, sessionToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return NextResponse.redirect(new URL("/?google=connected", process.env.APP_URL || "http://localhost:3000"));
}
