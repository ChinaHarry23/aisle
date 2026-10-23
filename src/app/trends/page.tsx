"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Trash2, Upload } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/ids";
import type { TrendSource, TrendSourceKind } from "@/lib/settings";
import { useAisle } from "@/lib/store";
import { PageHeader, SectionTitle } from "@/components/ui";

/** Formats the browser can read as text today. PDF and Office files are accepted but flagged. */
const TEXT_FILE = /\.(txt|md|markdown|csv|tsv|json|html?|xml|rtf)$/i;
const DOC_FILE = /\.(pdf|docx?|pptx?|xlsx?|txt|md|markdown|csv|tsv|json|html?|xml|rtf)$/i;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_CHARS = 120_000;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Returns a normalised address and label, or null when the text is not a web address. */
function parseWebsite(input: string): { value: string; label: string; kind: TrendSourceKind } | null {
  const text = input.trim();
  if (!text) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (!url.hostname.includes(".")) return null;
    const isFeed = /\.(xml|rss|atom)$/i.test(url.pathname) || /\/feed\/?$/i.test(url.pathname);
    return {
      value: url.toString(),
      label: url.hostname.replace(/^www\./, "") + (url.pathname !== "/" ? url.pathname : ""),
      kind: isFeed ? "feed" : "url",
    };
  } catch {
    return null;
  }
}

function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors",
        on ? "bg-ink" : "bg-line",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-surface transition-all",
          on ? "left-[1.1rem]" : "left-0.5",
        )}
      />
    </button>
  );
}

function detail(s: TrendSource) {
  const read = s.lastFetchedAt ? `Last read ${formatDate(s.lastFetchedAt, true)}` : "Not read yet";
  if (s.kind === "document") {
    return [
      s.size ? formatSize(s.size) : null,
      s.content ? read : "Text can’t be read yet",
      s.truncated ? "Trimmed to the size limit" : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return [s.kind === "feed" ? "Feed" : null, read].filter(Boolean).join(" · ");
}

/** One independent source group: its own heading, add control, notice and list. */
function SourcePanel({
  title,
  hint,
  kinds,
  sources,
  empty,
  children,
  notice,
  onToggle,
  onRemove,
}: {
  title: string;
  hint: string;
  kinds: TrendSourceKind[];
  sources: TrendSource[];
  empty: string;
  children: ReactNode;
  notice: string | null;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const own = sources.filter((s) => kinds.includes(s.kind));
  return (
    <section className="hairline">
      <div className="p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-serif text-lg md:text-xl">{title}</h3>
          <span className="text-xs text-mute">
            {own.filter((s) => s.enabled).length} of {own.length} on
          </span>
        </div>
        <p className="mt-1 text-xs text-mute">{hint}</p>
        <div className="mt-4">{children}</div>
        {notice ? (
          <p role="status" className="mt-2 text-xs text-ink-soft">
            {notice}
          </p>
        ) : null}
      </div>
      {own.length === 0 ? (
        <p className="border-t border-line px-5 py-4 text-sm text-mute">{empty}</p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {own.map((s) => (
            <li key={s.id} className="flex items-center gap-4 px-5 py-3">
              <Switch
                on={s.enabled}
                label={`${s.enabled ? "Turn off" : "Turn on"} ${s.label}`}
                onToggle={() => onToggle(s.id)}
              />
              <div className={cn("min-w-0 flex-1", !s.enabled && "opacity-50")}>
                <p className="truncate text-sm font-medium">{s.label}</p>
                <p className="truncate text-xs text-mute">{detail(s)}</p>
              </div>
              <button
                type="button"
                onClick={() => onRemove(s.id)}
                aria-label={`Remove ${s.label}`}
                className="p-1 text-mute hover:text-signal"
              >
                <Trash2 size={15} strokeWidth={1.7} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A single-line input with its own Add button. */
function AddField({
  placeholder,
  label,
  onAdd,
}: {
  placeholder: string;
  label: string;
  onAdd: (text: string) => boolean;
}) {
  const [text, setText] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (onAdd(text)) setText("");
      }}
      className="flex gap-2"
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="min-w-0 flex-1 border border-line px-3 py-2 text-sm outline-none focus:border-signal"
      />
      <button
        type="submit"
        disabled={!text.trim()}
        className="rounded-full btn-primary px-5 py-2 text-sm font-medium disabled:opacity-40"
      >
        Add
      </button>
    </form>
  );
}

export default function TrendsPage() {
  const campaigns = useAisle((s) => s.campaigns);
  const sources = useAisle((s) => s.settings.trendSources);
  const addTrendSources = useAisle((s) => s.addTrendSources);
  const toggleTrendSource = useAisle((s) => s.toggleTrendSource);
  const removeTrendSource = useAisle((s) => s.removeTrendSource);
  const [notices, setNotices] = useState<{ web: string | null; doc: string | null; topic: string | null }>({
    web: null,
    doc: null,
    topic: null,
  });
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const activity = useMemo(
    () =>
      campaigns
        .flatMap((c) => c.log.filter((e) => e.agent === "trend").map((e) => ({ ...e, campaign: c })))
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 8),
    [campaigns],
  );

  const note = (key: keyof typeof notices, text: string | null) =>
    setNotices((n) => ({ ...n, [key]: text }));

  function addWebsite(text: string) {
    const site = parseWebsite(text);
    if (!site) {
      note("web", "That doesn’t look like a web address. Try https://example.com/report.");
      return false;
    }
    const added = addTrendSources([site]);
    note("web", added ? null : "That website is already in the list.");
    return true;
  }

  function addTopic(text: string) {
    const topic = text.trim();
    if (!topic) return false;
    const added = addTrendSources([{ kind: "keyword", value: topic, label: topic }]);
    note("topic", added ? null : "That topic is already in the list.");
    return true;
  }

  async function addFiles(list: FileList | File[]) {
    const skipped: string[] = [];
    const incoming: Parameters<typeof addTrendSources>[0] = [];
    for (const file of Array.from(list)) {
      if (!DOC_FILE.test(file.name)) {
        skipped.push(`${file.name} is not a supported type.`);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        skipped.push(`${file.name} is over ${formatSize(MAX_FILE_BYTES)}.`);
        continue;
      }
      let content: string | undefined;
      let truncated = false;
      if (TEXT_FILE.test(file.name)) {
        try {
          const text = await file.text();
          truncated = text.length > MAX_CHARS;
          content = text.slice(0, MAX_CHARS);
        } catch {
          skipped.push(`${file.name} could not be read.`);
          continue;
        }
      }
      incoming.push({ kind: "document", value: file.name, label: file.name, content, size: file.size, truncated });
    }
    const added = addTrendSources(incoming);
    if (incoming.length > added) skipped.push(`${incoming.length - added} already in the list.`);
    note("doc", skipped.length > 0 ? skipped.join(" ") : null);
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Trend Analyser"
        title="Research reports & decisions"
        description="Find each campaign’s research report, see what is still missing, and review requests for your input."
      />

      <section aria-label="Campaign research reports">
        <SectionTitle title="Campaign reports" />
        <p className="mt-2 text-sm text-mute">Open a report for all research categories, evidence, conclusions and limitations.</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {campaigns.map(c => { const areas=c.researchCoverage ?? [];const count=areas.filter(a=>a.analysis).length;const requests=c.trendQuality ? c.trendRequests?.filter(r=>r.status==='pending').length??0 : c.trendGaps.filter(g=>g.needsFounder).length;return <article key={c.id} className="hairline p-5">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="status-chip status-wait">{c.trendQuality ? c.trendQuality.status==='COMPLETE' ? 'Evidence review passed' : c.status==='rejected'?'Analysis ended · partial report':'Incomplete · needs evidence' : c.researchAttempts?.length ? 'Draft · validation pending' : 'No verified research run'}</span>{requests>0&&<span className="text-xs text-signal">{requests} need your input</span>}</div>
            <h3 className="mt-3 font-serif text-xl">{c.name}</h3><p className="mt-2 text-sm text-mute">{c.country} · {c.startDate} – {c.endDate}</p>
            <p className="mt-3 text-sm">{count} / {areas.length || 7+c.channels.length} research areas assessed</p>
            <div className="mt-4 flex flex-wrap gap-4 text-sm text-signal"><Link href={`/campaigns/${c.id}?tab=research`}>Open full report →</Link>{requests>0&&<Link href={`/campaigns/${c.id}?tab=research#research-decisions`}>Review requests →</Link>}</div>
          </article>;})}
          {!campaigns.length&&<p className="text-sm text-mute">Create a campaign to start a research report.</p>}
        </div>
      </section>
      <section aria-label="Research requests across campaigns">
        <SectionTitle title="Needs your attention" />
        <p className="mt-2 text-sm text-mute">Research clarification and evidence review are separate from advertising approval. Approving a decision cannot replace missing evidence.</p>
        <ul className="mt-4 space-y-3">{campaigns.flatMap(c=>c.trendGaps.filter(g=>g.needsFounder&&(!c.trendQuality||c.trendRequests?.some(r=>r.id===g.id&&r.status==='pending'))).map(g=><li key={`${c.id}:${g.id}`} className="hairline p-4">
          <p className="text-xs text-signal">{c.name} · {g.kind.replaceAll('_',' ')}</p><h3 className="mt-2 font-medium">{g.detail}</h3><p className="mt-2 text-sm text-mute">Impact: {g.effect}</p><Link className="mt-3 inline-block text-sm text-signal" href={`/campaigns/${c.id}?tab=research#research-decisions`}>See evidence and next action →</Link>
        </li>))}</ul>
        {!campaigns.some(c=>c.trendGaps.some(g=>g.needsFounder&&(!c.trendQuality||c.trendRequests?.some(r=>r.id===g.id&&r.status==='pending'))))&&<p className="mt-4 rounded-xl border border-line p-4 text-sm text-mute">No research decisions are waiting for you. Reports without a verified run still need research; this is not a completion signal.</p>}
      </section>
      <details className="hairline p-5">
        <summary className="cursor-pointer font-medium">Research source workspace · optional configuration</summary>
        <p className="my-4 text-sm text-mute">Saved sources are candidate inputs, not verified findings. Adding or enabling a source does not prove that a research run used it. Check each report’s execution records. Authorise retail exports within the relevant campaign.</p>
      <div className="flex flex-col gap-4">
        <SourcePanel
          title="Websites"
          hint="Articles, reports, competitor pages or RSS feeds. Add them one at a time."
          kinds={["url", "feed"]}
          sources={sources}
          empty="No websites added."
          notice={notices.web}
          onToggle={toggleTrendSource}
          onRemove={removeTrendSource}
        >
          <AddField label="Website address" placeholder="https://example.com/report" onAdd={addWebsite} />
        </SourcePanel>

        <SourcePanel
          title="Documents"
          hint="Files from your computer. Text, CSV, Markdown, JSON and HTML are read in full, up to 5 MB each. PDF and Office files can be added, but their text can’t be read yet."
          kinds={["document"]}
          sources={sources}
          empty="No documents added."
          notice={notices.doc}
          onToggle={toggleTrendSource}
          onRemove={removeTrendSource}
        >
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void addFiles(e.dataTransfer.files);
            }}
            className={cn(
              "flex flex-wrap items-center justify-between gap-3 border border-dashed px-4 py-3 text-sm",
              dragging ? "border-signal bg-paper-2" : "border-line",
            )}
          >
            <span className="text-ink-soft">Drop files here, or choose them from your computer.</span>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex items-center gap-2 rounded-full border border-line font-medium hover:bg-paper-2 px-4 py-1.5 text-xs"
            >
              <Upload size={14} strokeWidth={1.8} />
              Choose files
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.xml,.rtf"
              onChange={(e) => {
                if (e.target.files) void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        </SourcePanel>

        <SourcePanel
          title="Topics"
          hint="Keywords, hashtags or markets to watch."
          kinds={["keyword"]}
          sources={sources}
          empty="No topics added."
          notice={notices.topic}
          onToggle={toggleTrendSource}
          onRemove={removeTrendSource}
        >
          <AddField label="Topic" placeholder="#cleanlabel, oat snacks" onAdd={addTopic} />
        </SourcePanel>
      </div>

      </details>

      {activity.length > 0 ? (
        <section>
          <SectionTitle title="Recent activity" />
          <ol className="hairline mt-4 divide-y divide-line">
            {activity.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3">
                <span className="text-sm">{e.title}</span>
                <span className="text-xs text-mute">
                  {e.campaign.name} · {formatDate(e.at, true)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
