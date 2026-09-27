import { uid } from "@/lib/ids";
import type { WhatsappInbox, WhatsappItem, WhatsappKind, WhatsappMessage, WhatsappSource } from "./types";
import { emptyInbox } from "./types";

const INVISIBLE = /[\u200e\u200f\u202a\u202c\u202d\u202e\ufeff]/g;
const GOAL_LEAD = /^(?:goal|objective|okr|aim)\b\s*[:\-–—]?\s*/i;
const TASK_LEAD =
  /^(?:task|todo|to-?do|action(?:\s*item)?|deadline|due|assignment|assigned)\b\s*[:\-–—]?\s*/i;
const INLINE_GOAL = /\b(?:goal|objective|okr)\b/i;
const INLINE_TASK = /\b(?:task|to-?do|deadline|due\b|assigned?|action item|ahr[-\s]?\d+)\b/i;
const NEED = /\b(?:we need to|please (?:do|finish|complete|send|update)|don'?t forget|action required)\b/i;
const SYSTEM = /^(messages and calls are end-to-end encrypted|you created this group|.* created group |.* added |.* left|.* joined using|waiting for this message|this message was deleted|<media omitted>|image omitted|video omitted|sticker omitted|document omitted|contact card omitted)/i;

const IOS =
  /^\[(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}),?\s+([^\]]+)\]\s+([^:]+):\s([\s\S]*)$/;
const ANDROID =
  /^(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?m\.?)?)\s+-\s+([^:]+):\s([\s\S]*)$/i;

function clean(value: string) {
  return value.replace(INVISIBLE, "").replace(/\r/g, "");
}

function hashId(prefix: string, value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${prefix}_${(h >>> 0).toString(36)}`;
}

function toIso(datePart: string, timePart: string) {
  const sep = datePart.includes(".") ? "." : datePart.includes("-") ? "-" : "/";
  const bits = datePart.split(sep).map((s) => Number(s.trim()));
  if (bits.length < 3 || bits.some((n) => Number.isNaN(n))) return new Date().toISOString();
  let [day, month, year] = bits;
  if (year < 100) year += 2000;
  if (month > 12 && day <= 12) {
    const swap = day;
    day = month;
    month = swap;
  }
  const clock = timePart.replace(/\u202f/g, " ").trim().toLowerCase();
  const ampm = clock.match(/\b(am|pm)\b/);
  const [hhRaw, mmRaw, ssRaw] = clock.replace(/\b(am|pm)\b/, "").trim().split(":");
  let hh = Number(hhRaw) || 0;
  const mm = Number(mmRaw) || 0;
  const ss = Number(ssRaw) || 0;
  if (ampm?.[1] === "pm" && hh < 12) hh += 12;
  if (ampm?.[1] === "am" && hh === 12) hh = 0;
  const d = new Date(year, month - 1, day, hh, mm, ss);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function parseHeader(line: string) {
  const ios = line.match(IOS);
  if (ios) {
    return {
      at: toIso(ios[1], ios[2]),
      author: ios[3].trim(),
      body: ios[4],
    };
  }
  const android = line.match(ANDROID);
  if (android) {
    return {
      at: toIso(android[1], android[2]),
      author: android[3].trim(),
      body: android[4],
    };
  }
  return null;
}

export function classifyLine(raw: string): { kind: WhatsappKind; text: string } | null {
  const line = raw.trim();
  if (!line || SYSTEM.test(line) || line.length < 3) return null;
  if (GOAL_LEAD.test(line)) {
    const text = line.replace(GOAL_LEAD, "").trim() || line;
    return { kind: "goal", text };
  }
  if (TASK_LEAD.test(line)) {
    const text = line.replace(TASK_LEAD, "").trim() || line;
    return { kind: "task", text };
  }
  if (INLINE_GOAL.test(line)) return { kind: "goal", text: line };
  if (INLINE_TASK.test(line) || NEED.test(line)) return { kind: "task", text: line };
  return null;
}

export function itemsFromMessage(message: WhatsappMessage): WhatsappItem[] {
  const lines = message.body.split("\n").map((l) => l.trim()).filter(Boolean);
  const found: WhatsappItem[] = [];
  const seen = new Set<string>();
  const candidates = lines.length > 0 ? lines : [message.body];
  for (const line of candidates) {
    const hit = classifyLine(line);
    if (!hit) continue;
    const key = `${hit.kind}:${hit.text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({
      id: hashId("wi", `${message.id}:${key}`),
      kind: hit.kind,
      text: hit.text,
      author: message.author,
      at: message.at,
      messageId: message.id,
      done: false,
    });
  }
  if (found.length === 0) {
    const whole = classifyLine(message.body.replace(/\n/g, " "));
    if (whole) {
      found.push({
        id: hashId("wi", `${message.id}:${whole.kind}:${whole.text.toLowerCase()}`),
        kind: whole.kind,
        text: whole.text,
        author: message.author,
        at: message.at,
        messageId: message.id,
        done: false,
      });
    }
  }
  return found;
}

export function parseWhatsappExport(raw: string, source: WhatsappSource = "export"): WhatsappMessage[] {
  const text = clean(raw).trim();
  if (!text) return [];
  const lines = text.split("\n");
  const messages: WhatsappMessage[] = [];
  let current: WhatsappMessage | null = null;

  const flush = () => {
    if (!current) return;
    const body = current.body.trim();
    if (!body || SYSTEM.test(body)) {
      current = null;
      return;
    }
    messages.push({ ...current, body });
    current = null;
  };

  for (const rawLine of lines) {
    const line = clean(rawLine);
    if (!line) {
      if (current) current.body += "\n";
      continue;
    }
    if (/^whatsapp chat with /i.test(line)) continue;
    const header = parseHeader(line);
    if (header) {
      flush();
      current = {
        id: hashId("wm", `${header.at}|${header.author}|${header.body}`),
        at: header.at,
        from: header.author,
        author: header.author,
        body: header.body,
        source,
      };
      continue;
    }
    if (current) current.body += `\n${line}`;
  }
  flush();
  return messages;
}

export function inboxFromMessages(messages: WhatsappMessage[], prior: WhatsappInbox = emptyInbox()): WhatsappInbox {
  const byMessage = new Map(prior.messages.map((m) => [m.id, m]));
  for (const message of messages) {
    if (!byMessage.has(message.id)) byMessage.set(message.id, message);
  }
  const byItem = new Map(prior.items.map((item) => [item.id, item]));
  for (const message of byMessage.values()) {
    for (const item of itemsFromMessage(message)) {
      const existing = byItem.get(item.id);
      byItem.set(item.id, existing ? { ...item, done: existing.done } : item);
    }
  }
  const mergedMessages = [...byMessage.values()].sort((a, b) => a.at.localeCompare(b.at));
  const mergedItems = [...byItem.values()].sort((a, b) => b.at.localeCompare(a.at));
  return {
    messages: mergedMessages.slice(-400),
    items: mergedItems.slice(0, 240),
    updatedAt: new Date().toISOString(),
  };
}

export function messageFromWebhook(input: {
  id?: string;
  from?: string;
  author?: string;
  body?: string;
  timestamp?: string;
}): WhatsappMessage | null {
  const body = (input.body ?? "").trim();
  if (!body) return null;
  const at = input.timestamp
    ? new Date(Number(input.timestamp) * (input.timestamp.length <= 10 ? 1000 : 1)).toISOString()
    : new Date().toISOString();
  const author = (input.author || input.from || "WhatsApp").trim();
  return {
    id: input.id || uid("wm"),
    at: Number.isNaN(Date.parse(at)) ? new Date().toISOString() : at,
    from: input.from || author,
    author,
    body,
    source: "webhook",
  };
}
