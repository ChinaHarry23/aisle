import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { loadWorkspace, saveWorkspace, type WorkspaceSnapshot } from "@/lib/auth/workspace";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const workspace = await loadWorkspace(user.id, user.role);
  return NextResponse.json(workspace);
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Partial<WorkspaceSnapshot> | null;
  if (!body) return NextResponse.json({ error: "Missing workspace." }, { status: 400 });
  await saveWorkspace(user.id, {
    brand: body.brand as WorkspaceSnapshot["brand"],
    campaigns: body.campaigns as WorkspaceSnapshot["campaigns"],
    settings: body.settings as WorkspaceSnapshot["settings"],
  });
  return NextResponse.json({ ok: true });
}
