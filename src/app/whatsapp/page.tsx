"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Empty, SectionTitle, Stat } from "@/components/ui";
import { formatDate } from "@/lib/ids";
import type { WhatsappInbox, WhatsappItem } from "@/lib/whatsapp/types";
import { emptyInbox } from "@/lib/whatsapp/types";

type InboxResponse = {
  inbox: WhatsappInbox;
  shared?: boolean;
  error?: string;
  imported?: { messages: number; items: number };
};

type WhatsappStatus = {
  live: boolean;
  displayNumber: string | null;
};

function ItemList({
  items,
  onToggle,
}: {
  items: WhatsappItem[];
  onToggle: (id: string, done: boolean) => void;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-mute">Nothing extracted yet.</p>;
  }
  return (
    <ul className="divide-y divide-line">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-3 py-3">
          <input
            type="checkbox"
            checked={item.done}
            onChange={(e) => onToggle(item.id, e.target.checked)}
            className="mt-1"
            aria-label={item.done ? "Mark open" : "Mark done"}
          />
          <div className="min-w-0">
            <p className={`text-sm leading-relaxed ${item.done ? "text-mute line-through" : ""}`}>
              {item.text}
            </p>
            <p className="mt-1 text-[11px] uppercase tracking-wider text-mute">
              {item.author} · {formatDate(item.at, true)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function WhatsappPage() {
  const [inbox, setInbox] = useState<WhatsappInbox>(emptyInbox());
  const [shared, setShared] = useState(false);
  const [status, setStatus] = useState<WhatsappStatus | null>(null);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const apply = useCallback((json: InboxResponse) => {
    if (json.inbox) setInbox(json.inbox);
    if (typeof json.shared === "boolean") setShared(json.shared);
  }, []);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/whatsapp/inbox");
    const json = (await res.json()) as InboxResponse;
    if (!res.ok) throw new Error(json.error || "Could not load inbox.");
    apply(json);
  }, [apply]);

  useEffect(() => {
    setWebhookUrl(`${window.location.origin}/api/whatsapp/webhook`);
    let cancelled = false;
    void Promise.all([
      refresh().catch((err: Error) => {
        if (!cancelled) setError(err.message);
      }),
      fetch("/api/settings/status")
        .then((r) => r.json())
        .then((json: { whatsapp?: WhatsappStatus }) => {
          if (!cancelled) setStatus(json.whatsapp ?? null);
        })
        .catch(() => {
          if (!cancelled) setStatus(null);
        }),
    ]);
    const timer = setInterval(() => {
      void refresh().catch(() => undefined);
    }, 20000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refresh]);

  async function importText(text: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/whatsapp/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = (await res.json()) as InboxResponse;
      if (!res.ok) throw new Error(json.error || "Import failed.");
      apply(json);
      setPaste("");
      const added = json.imported?.messages ?? 0;
      setNote(
        shared
          ? `Imported ${added} messages into the team inbox. Everyone on a desk can see the tasks.`
          : `Imported ${added} messages onto this desk.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (name.endsWith(".zip")) {
      setError("WhatsApp zipped the export. Open the zip and drop _chat.txt instead.");
      return;
    }
    const text = await file.text();
    await importText(text);
  }

  async function clearInbox() {
    if (!window.confirm(shared ? "Clear the shared team inbox for every desk?" : "Clear the imported chat on this desk?")) {
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/whatsapp/inbox", { method: "DELETE" });
      const json = (await res.json()) as InboxResponse;
      if (!res.ok) throw new Error(json.error || "Could not clear inbox.");
      apply(json);
      setNote("Inbox cleared.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear inbox.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(itemId: string, done: boolean) {
    const res = await fetch("/api/whatsapp/inbox", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, done }),
    });
    const json = (await res.json()) as InboxResponse;
    if (res.ok) apply(json);
  }

  const goals = useMemo(() => inbox.items.filter((i) => i.kind === "goal"), [inbox.items]);
  const tasks = useMemo(() => inbox.items.filter((i) => i.kind === "task"), [inbox.items]);
  const openGoals = goals.filter((i) => !i.done).length;
  const openTasks = tasks.filter((i) => !i.done).length;
  const recent = inbox.messages.slice(-12).reverse();

  return (
    <div className="flex flex-col gap-10">
      <header className="max-w-2xl">
        <p className="text-[11px] uppercase tracking-[0.2em] text-signal">Group mates</p>
        <h1 className="font-serif text-4xl">WhatsApp tasks.</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          Aisle cannot log into a personal WhatsApp account or silently read an existing group.
          WhatsApp only allows that for a Business number via Cloud API. For the class group, export
          the chat and drop it here — Aisle pulls out goals and tasks from lines like{" "}
          <code className="text-xs">Goal:</code>, <code className="text-xs">Task:</code>, deadlines,
          and AHR codes.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="Open goals" value={String(openGoals)} hint={shared ? "Shared team inbox" : "This desk"} />
        <Stat label="Open tasks" value={String(openTasks)} hint={`${inbox.messages.length} messages`} />
        <Stat
          label="Live line"
          value={status?.live ? "Ready" : "Import only"}
          hint={status?.displayNumber ? `Text ${status.displayNumber}` : "Cloud API optional"}
        />
      </section>

      <section className="grid gap-8 lg:grid-cols-2">
        <div className="hairline bg-surface p-5">
          <SectionTitle kicker="Works now" title="Import the group chat" />
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink-soft">
            <li>Open the group in WhatsApp on your phone.</li>
            <li>Group info → Export chat → Without media.</li>
            <li>AirDrop or save the <code className="text-xs">.txt</code> (if it is a zip, open it first).</li>
            <li>Drop the file or paste the text below.</li>
          </ol>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="rounded-full bg-ink px-4 py-2 text-sm text-paper hover:bg-ink-soft disabled:opacity-50"
            >
              {busy ? "Importing…" : "Upload chat.txt"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,text/plain"
              className="hidden"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </div>
          <label className="mt-4 block">
            <span className="text-[11px] uppercase tracking-wider text-mute">Or paste export</span>
            <textarea
              rows={6}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="[31/08/2026, 7:15:22 pm] Sam: Goal: finish AHR-04 this week"
              className="mt-1 w-full border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-ink"
            />
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy || !paste.trim()}
              onClick={() => void importText(paste)}
              className="rounded-full border border-ink px-4 py-2 text-sm hover:bg-paper disabled:opacity-50"
            >
              Extract tasks
            </button>
            {inbox.messages.length > 0 ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void clearInbox()}
                className="text-sm text-mute underline-offset-2 hover:underline"
              >
                Clear inbox
              </button>
            ) : null}
          </div>
          {error ? <p className="mt-3 text-sm text-signal">{error}</p> : null}
          {note ? <p className="mt-3 text-sm text-ok">{note}</p> : null}
        </div>

        <div className="hairline bg-surface p-5">
          <SectionTitle kicker="Optional live line" title="Cloud API webhook" />
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            If you later add a WhatsApp Business number in Meta, point the webhook here. Group mates
            can then text that number and new Task/Goal lines appear on every desk. This is not your
            personal WhatsApp login.
          </p>
          <label className="mt-4 block">
            <span className="text-[11px] uppercase tracking-wider text-mute">Callback URL</span>
            <input
              readOnly
              value={webhookUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-1 w-full border border-line bg-paper px-3 py-2 text-sm outline-none"
            />
          </label>
          <p className="mt-3 text-xs text-mute">
            Verify token and app secret stay in Vercel env as{" "}
            <code>WHATSAPP_VERIFY_TOKEN</code> and <code>WHATSAPP_APP_SECRET</code>. Subscribe to
            messages. {status?.live ? "Verification is configured." : "Not configured yet — import still works."}
          </p>
        </div>
      </section>

      <section className="grid gap-8 lg:grid-cols-2">
        <div>
          <SectionTitle kicker="From the group" title="Goals" />
          <div className="mt-4 hairline bg-surface px-5">
            {goals.length === 0 ? (
              <div className="py-6">
                <Empty
                  title="No goals yet"
                  body="Ask the group to write Goal: … or Objective: … then re-export the chat."
                />
              </div>
            ) : (
              <ItemList items={goals} onToggle={(id, done) => void toggle(id, done)} />
            )}
          </div>
        </div>
        <div>
          <SectionTitle kicker="From the group" title="Tasks" />
          <div className="mt-4 hairline bg-surface px-5">
            {tasks.length === 0 ? (
              <div className="py-6">
                <Empty
                  title="No tasks yet"
                  body="Lines starting with Task:, TODO, Deadline, or AHR-04 are picked up automatically."
                />
              </div>
            ) : (
              <ItemList items={tasks} onToggle={(id, done) => void toggle(id, done)} />
            )}
          </div>
        </div>
      </section>

      <section>
        <SectionTitle kicker="Source" title="Recent messages" />
        {recent.length === 0 ? (
          <div className="mt-4">
            <Empty title="Inbox empty" body="Import a WhatsApp export to see the group thread here." />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-line border-y border-line bg-surface">
            {recent.map((message) => (
              <li key={message.id} className="px-5 py-4">
                <p className="text-[11px] uppercase tracking-wider text-mute">
                  {message.author} · {formatDate(message.at, true)} · {message.source}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{message.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
