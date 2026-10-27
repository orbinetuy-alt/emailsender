import { NextResponse } from "next/server";
import { requireViewer } from "@/lib/auth";
import { getDashboard } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const viewer = await requireViewer();
    return NextResponse.json({ viewer, ...(await getDashboard(viewer.workspaceId)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 500 });
  }
}
