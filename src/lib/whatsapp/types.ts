export type WhatsappSource = "export" | "webhook";

export type WhatsappKind = "task" | "goal";

export type WhatsappMessage = {
  id: string
  at: string
  from: string
  author: string
  body: string
  source: WhatsappSource
};

export type WhatsappItem = {
  id: string
  kind: WhatsappKind
  text: string
  author: string
  at: string
  messageId: string
  done: boolean
};

export type WhatsappInbox = {
  messages: WhatsappMessage[]
  items: WhatsappItem[]
  updatedAt: string
};

export function emptyInbox(): WhatsappInbox {
  return { messages: [], items: [], updatedAt: new Date(0).toISOString() };
}
