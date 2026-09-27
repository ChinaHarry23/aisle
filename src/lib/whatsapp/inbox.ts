import { kvGet, kvSet } from "@/lib/auth/kv";
import type { UserRole } from "@/lib/auth/types";
import { inboxFromMessages } from "./parse";
import type { WhatsappInbox, WhatsappMessage } from "./types";
import { emptyInbox } from "./types";

const TEAM_KEY = "whatsapp/team";

function userKey(userId: string) {
  return `whatsapp/user/${userId}`;
}

export function inboxKey(userId: string, role: UserRole) {
  return role === "dev" ? TEAM_KEY : userKey(userId);
}

export async function loadInbox(userId: string, role: UserRole): Promise<WhatsappInbox> {
  const stored = await kvGet<WhatsappInbox>(inboxKey(userId, role));
  if (!stored) return emptyInbox();
  return {
    messages: stored.messages ?? [],
    items: stored.items ?? [],
    updatedAt: stored.updatedAt ?? new Date(0).toISOString(),
  };
}

export async function saveInbox(userId: string, role: UserRole, inbox: WhatsappInbox) {
  await kvSet(inboxKey(userId, role), inbox);
}

export async function mergeMessages(userId: string, role: UserRole, messages: WhatsappMessage[]) {
  const current = await loadInbox(userId, role);
  const next = inboxFromMessages(messages, current);
  await saveInbox(userId, role, next);
  return next;
}

export async function appendTeamMessages(messages: WhatsappMessage[]) {
  const current = (await kvGet<WhatsappInbox>(TEAM_KEY)) ?? emptyInbox();
  const next = inboxFromMessages(messages, current);
  await kvSet(TEAM_KEY, next);
  return next;
}

export async function clearInbox(userId: string, role: UserRole) {
  const next = emptyInbox();
  next.updatedAt = new Date().toISOString();
  await saveInbox(userId, role, next);
  return next;
}

export async function setItemDone(userId: string, role: UserRole, itemId: string, done: boolean) {
  const current = await loadInbox(userId, role);
  const items = current.items.map((item) => (item.id === itemId ? { ...item, done } : item));
  const next = { ...current, items, updatedAt: new Date().toISOString() };
  await saveInbox(userId, role, next);
  return next;
}
