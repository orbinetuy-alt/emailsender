import { cookies } from "next/headers";
import { hashToken } from "@/lib/crypto";
import { isDemoMode, query } from "@/lib/db";

export const SESSION_COOKIE = "outreach_session";

export type Viewer = {
  userId: string;
  workspaceId: string;
  email: string;
  name: string;
};

export async function requireViewer(): Promise<Viewer> {
  if (isDemoMode()) {
    return { userId: "demo-user", workspaceId: "demo-workspace", email: "demo@empresa.com", name: "María Fernández" };
  }
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (!rawToken) throw new Error("UNAUTHORIZED");
  const result = await query<Viewer & { expires_at: Date }>(
    `SELECT u.id AS "userId", u.workspace_id AS "workspaceId", u.email, COALESCE(u.name, u.email) AS name, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(rawToken)],
  );
  if (!result.rows[0]) throw new Error("UNAUTHORIZED");
  return result.rows[0];
}
