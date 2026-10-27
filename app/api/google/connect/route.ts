import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createGoogleAuthorizationUrl } from "@/lib/google";
import { isDemoMode } from "@/lib/db";
import { randomToken } from "@/lib/crypto";

export async function GET() {
  if (isDemoMode()) return NextResponse.redirect(new URL("/?google=demo", process.env.APP_URL || "http://localhost:3000"));
  const state = randomToken();
  const cookieStore = await cookies();
  cookieStore.set("google_oauth_state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  return NextResponse.redirect(createGoogleAuthorizationUrl(state));
}
