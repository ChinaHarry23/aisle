import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { clearInbox, loadInbox, mergeMessages, setItemDone } from "@/lib/whatsapp/inbox";
import { parseWhatsappExport } from "@/lib/whatsapp/parse";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const inbox = await loadInbox(user.id, user.role);
  return NextResponse.json({
    inbox,
    shared: user.role === "dev",
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { text?: string } | null;
  const text = body?.text?.trim() ?? "";
  if (!text) return NextResponse.json({ error: "Paste or upload a WhatsApp chat export." }, { status: 400 });
  const messages = parseWhatsappExport(text);
  if (messages.length === 0) {
    return NextResponse.json(
      { error: "No chat lines found. Export the group as a .txt file (without media) and try again." },
      { status: 400 },
    );
  }
  const inbox = await mergeMessages(user.id, user.role, messages);
  return NextResponse.json({
    inbox,
    shared: user.role === "dev",
    imported: { messages: messages.length, items: inbox.items.length },
  });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { itemId?: string; done?: boolean } | null;
  if (!body?.itemId || typeof body.done !== "boolean") {
    return NextResponse.json({ error: "Missing item." }, { status: 400 });
  }
  const inbox = await setItemDone(user.id, user.role, body.itemId, body.done);
  return NextResponse.json({ inbox, shared: user.role === "dev" });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const inbox = await clearInbox(user.id, user.role);
  return NextResponse.json({ inbox, shared: user.role === "dev" });
}
