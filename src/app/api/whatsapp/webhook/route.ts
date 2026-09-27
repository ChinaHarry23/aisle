import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { appendTeamMessages } from "@/lib/whatsapp/inbox";
import { messageFromWebhook } from "@/lib/whatsapp/parse";

export const runtime = "nodejs";

type WebhookContact = { profile?: { name?: string }; wa_id?: string };
type WebhookMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
};

function verifySignature(raw: string, header: string | null, secret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Verification failed." }, { status: 403 });
}

export async function POST(request: Request) {
  const raw = await request.text();
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (secret) {
    const signature = request.headers.get("x-hub-signature-256");
    if (!verifySignature(raw, signature, secret)) {
      return NextResponse.json({ error: "Bad signature." }, { status: 401 });
    }
  }

  let payload: {
    object?: string;
    entry?: Array<{
      changes?: Array<{
        value?: {
          contacts?: WebhookContact[];
          messages?: WebhookMessage[];
        };
      }>;
    }>;
  };
  try {
    payload = JSON.parse(raw || "{}") as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (payload.object && payload.object !== "whatsapp_business_account") {
    return NextResponse.json({ ok: true });
  }

  const names = new Map<string, string>();
  const incoming = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const contact of change.value?.contacts ?? []) {
        if (contact.wa_id && contact.profile?.name) names.set(contact.wa_id, contact.profile.name);
      }
      for (const message of change.value?.messages ?? []) {
        if (message.type && message.type !== "text") continue;
        const parsed = messageFromWebhook({
          id: message.id,
          from: message.from,
          author: (message.from && names.get(message.from)) || message.from,
          body: message.text?.body,
          timestamp: message.timestamp,
        });
        if (parsed) incoming.push(parsed);
      }
    }
  }

  if (incoming.length > 0) await appendTeamMessages(incoming);
  return NextResponse.json({ ok: true, accepted: incoming.length });
}
