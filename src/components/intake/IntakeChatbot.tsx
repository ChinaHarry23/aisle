"use client";

import { useEffect, useRef, useState } from "react";
import { BILLING_CHANGED } from "@/components/billing/events";
import {
  ASSISTANT_NOTE_PREFIX,
  MAX_INTAKE_TURNS,
  emptyIntakeDraft,
  optionsForMissingField,
  type IntakeChatMessage,
  type IntakeDraftState,
  type IntakeTurnOutput,
} from "@/lib/intake/shared";
import { channelLabel } from "@/lib/status";
import type { BrandProfile, CampaignInput, Channel, Country } from "@/lib/types";

type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function speechRecognitionCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition;
}

type Props = {
  brand: BrandProfile;
  form: CampaignInput;
  priorRecommendation?: { note: string; fromCampaignId: string; fromCampaignName: string } | null;
  onApplyDraft: (next: CampaignInput) => void;
  onSwitchToForm: () => void;
};

const ALL_CHANNELS: Channel[] = ["instagram", "web", "email", "print", "digital_signage"];
const ALL_COUNTRIES: Country[] = ["AU", "NZ", "UK", "US"];

export function IntakeChatbot({
  brand,
  form,
  priorRecommendation,
  onApplyDraft,
  onSwitchToForm,
}: Props) {
  const [draft, setDraft] = useState<IntakeDraftState>(() => ({
    ...emptyIntakeDraft(),
    name: form.name,
    product: form.product,
    category: form.category || "Grocery",
    targetAudience: form.targetAudience,
    objective: form.objective,
    budget: isBudgetExplicit(form) ? form.budget : 0,
    channels: form.product.trim() ? form.channels : [],
    startDate: form.product.trim() ? form.startDate : "",
    endDate: form.product.trim() ? form.endDate : "",
    country: form.country || "AU",
    notes: form.notes,
    fieldSources: {},
  }));

  const [messages, setMessages] = useState<IntakeChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: `Hi! I'm the ${brand.retailerName} intake assistant (AHR-01). Tell me about the campaign you're planning in a sentence or two — or pick a product below — and I'll interview you for what's missing and fill out the brief for your review. (I never guess budget, dates, country, or channels, and only you can launch.)`,
    },
  ]);
  const [input, setInput] = useState("");
  const [interimVoice, setInterimVoice] = useState("");
  const [listening, setListening] = useState(false);
  const [speechSupported] = useState(() => Boolean(speechRecognitionCtor()));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingField, setMissingField] =
    useState<IntakeTurnOutput["missingField"]>("product");
  const [options, setOptions] = useState<string[]>(() =>
    optionsForMissingField("product", emptyIntakeDraft()),
  );
  const [readyToReview, setReadyToReview] = useState(false);
  const [turnCount, setTurnCount] = useState(0);
  const [turnCapReached, setTurnCapReached] = useState(false);
  const [sessionCostUsd, setSessionCostUsd] = useState(0);
  const [sessionTokens, setSessionTokens] = useState(0);
  const [lastModelLabel, setLastModelLabel] = useState<string | null>(null);
  const msgCounterRef = useRef(0);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, sending]);

  function toggleVoice() {
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-AU";
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (event) => {
      let interim = "";
      let finalChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const res = event.results[i];
        if (res.isFinal) {
          finalChunk += res[0].transcript;
        } else {
          interim += res[0].transcript;
        }
      }
      setInterimVoice(interim);
      if (finalChunk.trim()) {
        setInput((prev) => (prev ? `${prev.trim()} ${finalChunk.trim()}` : finalChunk.trim()));
        setInterimVoice("");
      }
    };
    rec.onerror = () => {
      setListening(false);
      setInterimVoice("");
    };
    rec.onend = () => {
      setListening(false);
      setInterimVoice("");
    };
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  function syncToParent(nextDraft: IntakeDraftState) {
    onApplyDraft({
      name: nextDraft.name || form.name,
      product: nextDraft.product || form.product,
      category: nextDraft.category || form.category || "Grocery",
      targetAudience: nextDraft.targetAudience || form.targetAudience,
      objective: nextDraft.objective || form.objective,
      budget: nextDraft.budget > 0 ? nextDraft.budget : form.budget,
      channels: nextDraft.channels.length > 0 ? nextDraft.channels : form.channels,
      startDate: nextDraft.startDate || form.startDate,
      endDate: nextDraft.endDate || form.endDate,
      country: nextDraft.country || form.country,
      notes: nextDraft.notes || form.notes,
      unitCostAud: form.unitCostAud ?? null,
      currentPriceAud: form.currentPriceAud ?? null,
      productImageUrl: form.productImageUrl ?? null,
    });
  }

  async function sendTurn(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending || turnCapReached) return;
    setError(null);
    setInput("");
    setInterimVoice("");

    msgCounterRef.current += 1;
    const userMsg: IntakeChatMessage = {
      id: `u_${msgCounterRef.current}`,
      role: "user",
      content: trimmed,
    };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setSending(true);

    try {
      const res = await fetch("/api/intake/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          draft,
        }),
      });
      window.dispatchEvent(new Event(BILLING_CHANGED));
      const data = (await res.json().catch(() => null)) as
        | (IntakeTurnOutput & { error?: string })
        | null;

      if (!res.ok || !data || data.error) {
        setError(
          data?.error ??
            `The intake assistant could not respond (HTTP ${res.status}). You can continue in the form at any time.`,
        );
        return;
      }

      msgCounterRef.current += 1;
      const assistantMsg: IntakeChatMessage = {
        id: `a_${msgCounterRef.current}`,
        role: "assistant",
        content: data.reply,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setDraft(data.draft);
      setMissingField(data.missingField);
      setOptions(data.options ?? []);
      setReadyToReview(data.readyToReview);
      setTurnCount(data.turnCount);
      setTurnCapReached(data.turnCapReached);
      setSessionCostUsd((c) => Math.round((c + (data.trace?.costUsd ?? 0)) * 1e5) / 1e5);
      setSessionTokens((t) => t + (data.trace?.totalTokens ?? 0));
      setLastModelLabel(
        data.trace
          ? `${data.trace.modelName} (${data.trace.path === "live_model" ? "live agent" : "deterministic rules"})`
          : null,
      );

      syncToParent(data.draft);
    } catch {
      setError("Network error talking to the intake assistant. Your draft fields are preserved.");
    } finally {
      setSending(false);
    }
  }

  const completedCount = [
    draft.product.trim().length >= 3,
    draft.targetAudience.trim().length >= 3,
    draft.objective.trim().length >= 3,
    draft.budget > 0,
    draft.channels.length > 0,
    Boolean(draft.startDate && draft.endDate),
    Boolean(draft.country),
  ].filter(Boolean).length;

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1.35fr_1fr]">
      {/* Left: Chat conversation */}
      <div className="hairline flex flex-col justify-between bg-surface p-5">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-signal">
                AHR-01 · Conversational intake assistant
              </p>
              <h2 className="font-serif text-2xl">Describe your campaign.</h2>
            </div>
            <div className="text-right text-xs text-mute">
              <p>
                Turn {turnCount} of {MAX_INTAKE_TURNS} · est. ${sessionCostUsd.toFixed(4)}
                {sessionTokens > 0 ? ` · ${sessionTokens} tok` : ""}
              </p>
              {lastModelLabel ? <p className="text-[11px]">{lastModelLabel}</p> : null}
            </div>
          </div>

          {priorRecommendation ? (
            <div className="mt-3 border-l-2 border-signal bg-paper/60 px-3 py-2 text-xs text-ink-soft">
              <span className="font-medium text-ink">
                Attached AHR-06 recommendation ({priorRecommendation.fromCampaignName}):{" "}
              </span>
              {priorRecommendation.note}
            </div>
          ) : null}

          <ol
            className="mt-4 flex max-h-[26rem] flex-col gap-3 overflow-y-auto pr-1"
            aria-live="polite"
          >
            {messages.map((m, idx) => (
              <li
                key={m.id ?? idx}
                className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
              >
                <span className="text-[10px] uppercase tracking-wider text-mute">
                  {m.role === "user" ? "Human Founder" : "Inbound intake agent"}
                </span>
                <div
                  className={`mt-1 max-w-[90%] px-3.5 py-2.5 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-ink text-paper"
                      : "border border-line bg-paper text-ink"
                  }`}
                >
                  {m.content}
                </div>
              </li>
            ))}
            {sending ? (
              <li className="flex flex-col items-start">
                <span className="text-[10px] uppercase tracking-wider text-mute">
                  Inbound intake agent
                </span>
                <div className="mt-1 border border-line bg-paper px-3.5 py-2 text-xs text-mute">
                  Checking brief and brand rules…
                </div>
              </li>
            ) : null}
            <div ref={scrollEndRef} />
          </ol>

          {options.length > 0 && !turnCapReached ? (
            <div className="mt-4">
              <p className="text-[10px] uppercase tracking-wider text-mute">
                Suggested replies (click to send)
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {options.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    disabled={sending}
                    onClick={() => void sendTurn(opt)}
                    className="rounded-full border border-line bg-paper px-3 py-1 text-xs text-ink hover:border-ink disabled:opacity-50"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <form
          className="mt-4 border-t border-line pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void sendTurn(input);
          }}
        >
          {error ? <p className="mb-2 text-xs text-signal">{error}</p> : null}
          {interimVoice ? (
            <p className="mb-1.5 text-xs italic text-mute">Dictating: “{interimVoice}”</p>
          ) : null}
          <div className="flex gap-2">
            <input
              value={input}
              disabled={sending || turnCapReached}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                turnCapReached
                  ? "Turn limit reached — review and launch in the form."
                  : "Type your answer (e.g. “Promote navel oranges to inner-west families, budget $8,000, Instagram & Email, 2026-10-19 to 2026-11-01”)…"
              }
              className="flex-1 border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-ink disabled:opacity-50"
            />
            {speechSupported ? (
              <button
                type="button"
                aria-label={listening ? "Stop voice dictation" : "Start voice dictation"}
                aria-pressed={listening}
                title="Browser Web Speech dictation (en-AU). No audio leaves your device."
                onClick={toggleVoice}
                className={`px-3 py-2 text-xs uppercase tracking-wider ${
                  listening
                    ? "bg-signal text-paper"
                    : "border border-line bg-paper text-ink hover:border-ink"
                }`}
              >
                {listening ? "Stop mic" : "Voice"}
              </button>
            ) : null}
            <button
              type="submit"
              disabled={sending || !input.trim() || turnCapReached}
              className="bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
            >
              Send
            </button>
          </div>
          <p className="mt-2 text-[11px] text-mute">
            Guardrail (UC-01 step 6): Budget, dates, country, and channels are never auto-filled by
            the model. {speechSupported ? "Voice dictation runs locally in your browser." : "Voice dictation is unavailable in this browser; type your message above."}
          </p>
        </form>
      </div>

      {/* Right: Live Draft Inspector & Handoff to Form */}
      <aside className="hairline flex flex-col justify-between bg-surface p-5">
        <div>
          <div className="flex items-center justify-between border-b border-line pb-3">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-mute">Live brief card</p>
              <h3 className="font-serif text-xl">
                {completedCount} of 7 required fields ready
              </h3>
            </div>
            <span
              className={`status-chip ${readyToReview ? "risk-low" : "status-wait"}`}
            >
              {readyToReview ? "Valid brief" : `Needs ${missingField}`}
            </span>
          </div>

          <dl className="mt-4 flex flex-col gap-2.5 text-xs">
            <DraftFieldRow
              label="Campaign name"
              value={draft.name}
              source={draft.fieldSources.name}
              placeholder="Auto-suggested once product is set"
            />
            <DraftFieldRow
              label="Product"
              value={draft.product}
              source={draft.fieldSources.product}
              placeholder="Ask or type in chat"
            />
            <DraftFieldRow
              label="Category"
              value={draft.category}
              source={draft.fieldSources.category}
              placeholder="Grocery"
            />
            <DraftFieldRow
              label="Target audience"
              value={draft.targetAudience}
              source={draft.fieldSources.targetAudience}
              placeholder="Who buys this?"
            />
            <DraftFieldRow
              label="Objective"
              value={draft.objective}
              source={draft.fieldSources.objective}
              placeholder="What should this cycle achieve?"
            />
            <DraftFieldRow
              label="Budget (AUD) · Founder only"
              value={draft.budget > 0 ? `$${draft.budget.toLocaleString("en-AU")}` : ""}
              source={draft.fieldSources.budget}
              placeholder="Founder entry required"
              founderOnly
            />
            <DraftFieldRow
              label="Channels · Founder only"
              value={
                draft.channels.length > 0
                  ? draft.channels.map((c) => channelLabel[c]).join(", ")
                  : ""
              }
              source={draft.fieldSources.channels}
              placeholder="Founder entry required"
              founderOnly
            />
            <DraftFieldRow
              label="Dates · Founder only"
              value={
                draft.startDate && draft.endDate
                  ? `${draft.startDate} → ${draft.endDate}`
                  : ""
              }
              source={draft.fieldSources.startDate}
              placeholder="YYYY-MM-DD → YYYY-MM-DD"
              founderOnly
            />
            <DraftFieldRow
              label="Market · Founder only"
              value={draft.country}
              source={draft.fieldSources.country}
              placeholder="AU"
              founderOnly
            />
            {draft.notes ? (
              <div className="border-t border-line pt-2">
                <span className="text-[10px] uppercase tracking-wider text-mute">
                  Notes{" "}
                  {draft.notes.startsWith(ASSISTANT_NOTE_PREFIX.trim())
                    ? "· Assistant draft (confirm in form)"
                    : "· Founder"}
                </span>
                <p className="mt-0.5 text-ink-soft">{draft.notes}</p>
              </div>
            ) : null}
          </dl>

          {/* Quick Founder Scope Pickers inside the card so the founder can also click channels/country directly */}
          <div className="mt-4 border-t border-line pt-3">
            <p className="text-[10px] uppercase tracking-wider text-mute">
              Quick founder scope toggles
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {ALL_CHANNELS.map((ch) => {
                const active = draft.channels.includes(ch);
                return (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => {
                      const nextChannels = active
                        ? draft.channels.filter((x) => x !== ch)
                        : [...draft.channels, ch];
                      const next: IntakeDraftState = {
                        ...draft,
                        channels: nextChannels,
                        fieldSources: { ...draft.fieldSources, channels: "founder" },
                      };
                      setDraft(next);
                      syncToParent(next);
                    }}
                    className={`rounded-full px-2.5 py-1 text-[11px] ${
                      active
                        ? "bg-ink text-paper"
                        : "border border-line bg-paper text-ink-soft"
                    }`}
                  >
                    {channelLabel[ch]}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {ALL_COUNTRIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    const next: IntakeDraftState = {
                      ...draft,
                      country: c,
                      fieldSources: { ...draft.fieldSources, country: "founder" },
                    };
                    setDraft(next);
                    syncToParent(next);
                  }}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] ${
                    draft.country === c
                      ? "bg-signal text-paper"
                      : "border border-line bg-paper text-ink-soft"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 border-t border-line pt-4">
          <button
            type="button"
            onClick={() => {
              syncToParent(draft);
              onSwitchToForm();
            }}
            className="w-full rounded-full bg-ink px-4 py-2.5 text-sm text-paper"
          >
            {readyToReview
              ? "Review & Launch in Form →"
              : "Switch to Form with Current Draft →"}
          </button>
          <p className="mt-2 text-[11px] text-mute">
            The intake assistant never launches a campaign on its own. Reviewing in the form lets
            you edit any field before clicking “Launch agents”.
          </p>
        </div>
      </aside>
    </div>
  );
}

function DraftFieldRow({
  label,
  value,
  source,
  placeholder,
  founderOnly,
}: {
  label: string;
  value: string;
  source?: "founder" | "assistant";
  placeholder: string;
  founderOnly?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-line/60 pb-1.5">
      <dt className="text-[10px] uppercase tracking-wider text-mute">{label}</dt>
      <dd className="text-right">
        {value ? (
          <span className="font-medium text-ink">
            {value}{" "}
            {source ? (
              <span className="ml-1 rounded border border-line px-1 py-0.5 text-[9px] uppercase tracking-wider text-mute">
                {source}
              </span>
            ) : null}
          </span>
        ) : (
          <span className={`italic ${founderOnly ? "text-signal/80" : "text-mute"}`}>
            {placeholder}
          </span>
        )}
      </dd>
    </div>
  );
}

// Helper so the initial form default budget (8000) does not pretend the founder already answered the budget question in chat unless they edited it.
function isBudgetExplicit(form: CampaignInput): boolean {
  return Boolean(form.product && form.budget > 0);
}
