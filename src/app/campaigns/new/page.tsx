"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { IntakeChatbot } from "@/components/intake/IntakeChatbot";
import { ASSISTANT_NOTE_PREFIX } from "@/lib/intake/shared";
import { attachableRecommendation } from "@/lib/runtime/defaults";
import { validateIntake } from "@/lib/runtime/intake";
import type { CampaignInput, Channel, Country, IntakeFieldSources } from "@/lib/types";
import { channelLabel } from "@/lib/status";
import { useAisle } from "@/lib/store";

const channels: Channel[] = ["instagram", "web", "email", "print", "digital_signage"];
const countries: Country[] = ["AU", "NZ", "UK", "US"];

const empty: CampaignInput = {
  name: "",
  product: "",
  category: "Grocery",
  targetAudience: "",
  objective: "",
  budget: 8000,
  channels: ["instagram", "web", "email"],
  startDate: "2026-08-26",
  endDate: "2026-09-08",
  country: "AU",
  notes: "",
  fieldSources: {},
  intakeLog: [],
};

export default function NewCampaignPage() {
  const router = useRouter();
  const createCampaign = useAisle((s) => s.createCampaign);
  const launch = useAisle((s) => s.launch);
  const brand = useAisle((s) => s.brand);
  const campaigns = useAisle((s) => s.campaigns);
  const [mode, setMode] = useState<"form" | "chat">("form");
  const [error, setError] = useState("");
  const [form, setForm] = useState<CampaignInput>(empty);

  const priorRecommendation = useMemo(
    () => attachableRecommendation(campaigns),
    [campaigns],
  );

  function update<K extends keyof CampaignInput>(
    key: K,
    value: CampaignInput[K],
    source: "founder" | "assistant" = "founder",
  ) {
    setForm((f) => {
      const nextSources: IntakeFieldSources = { ...(f.fieldSources ?? {}) };
      if (key in empty && key !== "fieldSources" && key !== "intakeLog") {
        nextSources[key as keyof IntakeFieldSources] = source;
      }
      // Once the founder edits an assistant-drafted note, strip the unconfirmed prefix.
      let finalValue = value;
      if (
        key === "notes" &&
        source === "founder" &&
        typeof value === "string" &&
        value.startsWith(ASSISTANT_NOTE_PREFIX)
      ) {
        finalValue = value.slice(ASSISTANT_NOTE_PREFIX.length) as CampaignInput[K];
      }
      return {
        ...f,
        [key]: finalValue,
        fieldSources: nextSources,
      };
    });
  }

  /** UC-01 steps 4–5 run in the form too, so a launch is never a surprise. */
  const problems = validateIntake(form, brand);

  function toggleChannel(ch: Channel) {
    setForm((f) => ({
      ...f,
      channels: f.channels.includes(ch)
        ? f.channels.filter((x) => x !== ch)
        : [...f.channels, ch],
      fieldSources: { ...(f.fieldSources ?? {}), channels: "founder" },
    }));
  }

  async function submit(run: boolean) {
    if (problems.length > 0) {
      setError(
        run
          ? `The pipeline will not start: ${problems.map((p) => p.message).join(" ")}`
          : "Fix the brief before saving.",
      );
      return;
    }
    setError("");
    const id = createCampaign(form);
    router.push(`/campaigns/${id}`);
    if (run) await launch(id);
  }

  const hasAssistantNotesPrefix =
    typeof form.notes === "string" && form.notes.startsWith(ASSISTANT_NOTE_PREFIX.trim());

  return (
    <div className={mode === "chat" ? "mx-auto max-w-5xl" : "mx-auto max-w-2xl"}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-signal">Campaign management</p>
          <h1 className="mt-1 font-serif text-4xl">Write the brief.</h1>
        </div>
        <div
          role="tablist"
          aria-label="Campaign intake mode"
          className="inline-flex border border-line bg-surface p-1 text-xs"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "form"}
            onClick={() => setMode("form")}
            className={`px-3.5 py-1.5 transition-colors ${
              mode === "form" ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
            }`}
          >
            Write in form
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "chat"}
            onClick={() => setMode("chat")}
            className={`px-3.5 py-1.5 transition-colors ${
              mode === "chat" ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
            }`}
          >
            Describe with AI assistant
          </button>
        </div>
      </div>

      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-soft">
        You specify product, audience, objective, budget, channels, and market. Aisle turns that
        into tasks for Trend Analyser, Image Generation, Compliance, and Media Manager — using{" "}
        {brand.retailerName} brand rules. Switch between the structured form and the conversational
        intake assistant at any time.
      </p>

      {mode === "chat" ? (
        <IntakeChatbot
          brand={brand}
          form={form}
          priorRecommendation={priorRecommendation}
          onApplyDraft={(next) => setForm(next)}
          onSwitchToForm={() => setMode("form")}
        />
      ) : (
        <>
          {problems.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-1 text-xs text-mute">
              {problems.map((p) => (
                <li key={`${p.field}-${p.message}`}>
                  {p.field}: {p.message} <span className="opacity-70">({p.clause})</span>
                </li>
              ))}
            </ul>
          ) : null}

          <form
            className="mt-8 flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(true);
            }}
          >
            <label className="block">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider text-mute">
                  Campaign name
                </span>
                <ProvenanceBadge source={form.fieldSources?.name} />
              </div>
              <input
                required
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="Week 35 catalogue — citrus"
                className="mt-1 w-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
              />
            </label>
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="block">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wider text-mute">Product</span>
                  <ProvenanceBadge source={form.fieldSources?.product} />
                </div>
                <input
                  required
                  value={form.product}
                  onChange={(e) => update("product", e.target.value)}
                  placeholder="Navel oranges + Lane & Co. juice"
                  className="mt-1 w-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
                />
              </label>
              <label className="block">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wider text-mute">Category</span>
                  <ProvenanceBadge source={form.fieldSources?.category} />
                </div>
                <select
                  value={form.category}
                  onChange={(e) => update("category", e.target.value)}
                  className="mt-1 w-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
                >
                  {["Grocery", "Apparel", "Pantry", "Home", "Beauty"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider text-mute">
                  Target audience
                </span>
                <ProvenanceBadge source={form.fieldSources?.targetAudience} />
              </div>
              <input
                required
                value={form.targetAudience}
                onChange={(e) => update("targetAudience", e.target.value)}
                placeholder="Household shoppers, 28–45"
                className="mt-1 w-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
              />
            </label>
            <label className="block">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider text-mute">Objective</span>
                <ProvenanceBadge source={form.fieldSources?.objective} />
              </div>
              <input
                required
                value={form.objective}
                onChange={(e) => update("objective", e.target.value)}
                placeholder="Lift catalogue engagement and basket attach"
                className="mt-1 w-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
              />
            </label>
            <div className="grid gap-5 sm:grid-cols-3">
              <label className="block">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wider text-mute">
                    Budget (AUD)
                  </span>
                  <ProvenanceBadge source={form.fieldSources?.budget} founderEntry />
                </div>
                <input
                  type="number"
                  min={500}
                  value={form.budget}
                  onChange={(e) => update("budget", Number(e.target.value))}
                  className="mt-1 w-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
                />
              </label>
              <label className="block">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wider text-mute">Starts</span>
                  <ProvenanceBadge source={form.fieldSources?.startDate} founderEntry />
                </div>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => update("startDate", e.target.value)}
                  className="mt-1 w-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
                />
              </label>
              <label className="block">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wider text-mute">Ends</span>
                  <ProvenanceBadge source={form.fieldSources?.endDate} founderEntry />
                </div>
                <input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => update("endDate", e.target.value)}
                  className="mt-1 w-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
                />
              </label>
            </div>
            <fieldset>
              <div className="flex items-center justify-between">
                <legend className="text-[11px] uppercase tracking-wider text-mute">
                  Channels
                </legend>
                <ProvenanceBadge source={form.fieldSources?.channels} founderEntry />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {channels.map((ch) => {
                  const on = form.channels.includes(ch);
                  return (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => toggleChannel(ch)}
                      className={`rounded-full px-3 py-1.5 text-sm ${
                        on ? "bg-ink text-paper" : "border border-line bg-surface"
                      }`}
                    >
                      {channelLabel[ch]}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <fieldset>
              <div className="flex items-center justify-between">
                <legend className="text-[11px] uppercase tracking-wider text-mute">
                  Market (country-specific compliance)
                </legend>
                <ProvenanceBadge source={form.fieldSources?.country} founderEntry />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {countries.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => update("country", c)}
                    className={`rounded-full px-3 py-1.5 text-sm ${
                      form.country === c
                        ? "bg-signal text-paper"
                        : "border border-line bg-surface"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="block">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider text-mute">
                  Founder notes
                </span>
                <div className="flex items-center gap-2">
                  {hasAssistantNotesPrefix ? (
                    <button
                      type="button"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          notes: f.notes.replace(ASSISTANT_NOTE_PREFIX, "").trim(),
                          fieldSources: { ...(f.fieldSources ?? {}), notes: "founder" },
                        }))
                      }
                      className="text-[10px] uppercase tracking-wider text-signal underline"
                    >
                      Confirm assistant note as founder fact
                    </button>
                  ) : null}
                  <ProvenanceBadge source={form.fieldSources?.notes} />
                </div>
              </div>
              <textarea
                value={form.notes}
                onChange={(e) => update("notes", e.target.value)}
                rows={3}
                placeholder="Keep it edible, not wellness-cult."
                className="mt-1 w-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
              />
            </label>
            <div className="flex flex-wrap gap-2 pt-2">
              {error ? <p className="w-full text-sm text-signal">{error}</p> : null}
              <button
                type="submit"
                className="rounded-full bg-ink px-5 py-2.5 text-sm text-paper"
              >
                Launch agents
              </button>
              <button
                type="button"
                onClick={() => void submit(false)}
                className="rounded-full border border-ink px-5 py-2.5 text-sm"
              >
                Save draft
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

function ProvenanceBadge({
  source,
  founderEntry,
}: {
  source?: "founder" | "assistant";
  founderEntry?: boolean;
}) {
  if (!source) {
    return founderEntry ? (
      <span className="text-[10px] uppercase tracking-wider text-mute">Founder entry</span>
    ) : null;
  }
  return (
    <span
      className={`px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
        source === "assistant"
          ? "border border-amber-700/40 text-amber-800"
          : "border border-line text-mute"
      }`}
    >
      {source === "assistant" ? "Drafted by assistant" : "Founder confirmed"}
    </span>
  );
}
