"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { validateIntake } from "@/lib/runtime/intake";
import type { CampaignInput, Channel, Country } from "@/lib/types";
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
};

export default function NewCampaignPage() {
  const router = useRouter();
  const createCampaign = useAisle((s) => s.createCampaign);
  const launch = useAisle((s) => s.launch);
  const brand = useAisle((s) => s.brand);
  const [error, setError] = useState("");

  /* A brief handed over from the WhatsApp desk pre-fills the form once, at mount.
     Reading the handover during the initial render (rather than in an effect)
     keeps this to a single render and leaves no stale draft behind for the next
     visit. The founder still completes and launches it: intake never starts the
     bench on its own. */
  const [handoff] = useState(() => {
    const draft = useAisle.getState().intakeDraft;
    if (!draft) return null;
    useAisle.getState().setIntakeDraft(null);
    return draft;
  });
  const [form, setForm] = useState<CampaignInput>(() => ({ ...empty, ...(handoff?.input ?? {}) }));

  function update<K extends keyof CampaignInput>(key: K, value: CampaignInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /** UC-01 steps 4–5 run in the form too, so a launch is never a surprise. */
  const problems = validateIntake(form, brand);

  function toggleChannel(ch: Channel) {
    setForm((f) => ({
      ...f,
      channels: f.channels.includes(ch)
        ? f.channels.filter((x) => x !== ch)
        : [...f.channels, ch],
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

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-[11px] uppercase tracking-[0.2em] text-signal">Campaign management</p>
      <h1 className="mt-1 font-serif text-4xl">Write the brief.</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        You specify product, audience, objective, budget, channels, and market. Aisle turns that
        into tasks for Trend Analyser, Image Generation, Compliance, and Media Manager — using{" "}
        {brand.retailerName} brand rules.
      </p>

      {handoff ? (
        <p className="mt-4 border-l-2 border-signal pl-3 text-sm text-ink-soft">
          Started from {handoff.source}. Check every field before launching — Aisle never invents a
          product, audience, budget, country or channel you did not provide.
        </p>
      ) : null}

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
          <span className="text-[11px] uppercase tracking-wider text-mute">Campaign name</span>
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
            <span className="text-[11px] uppercase tracking-wider text-mute">Product</span>
            <input
              required
              value={form.product}
              onChange={(e) => update("product", e.target.value)}
              placeholder="Navel oranges + Lane & Co. juice"
              className="mt-1 w-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-mute">Category</span>
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
          <span className="text-[11px] uppercase tracking-wider text-mute">Target audience</span>
          <input
            required
            value={form.targetAudience}
            onChange={(e) => update("targetAudience", e.target.value)}
            placeholder="Household shoppers, 28–45"
            className="mt-1 w-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
          />
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wider text-mute">Objective</span>
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
            <span className="text-[11px] uppercase tracking-wider text-mute">Budget (AUD)</span>
            <input
              type="number"
              min={500}
              value={form.budget}
              onChange={(e) => update("budget", Number(e.target.value))}
              className="mt-1 w-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-mute">Starts</span>
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => update("startDate", e.target.value)}
              className="mt-1 w-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-mute">Ends</span>
            <input
              type="date"
              value={form.endDate}
              onChange={(e) => update("endDate", e.target.value)}
              className="mt-1 w-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
            />
          </label>
        </div>
        <fieldset>
          <legend className="text-[11px] uppercase tracking-wider text-mute">Channels</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {channels.map((ch) => {
              const on = form.channels.includes(ch);
              return (
                <button
                  key={ch}
                  type="button"
                  onClick={() => toggleChannel(ch)}
                  className={`rounded-full px-3 py-1.5 text-sm ${on ? "bg-ink text-paper" : "border border-line bg-surface"}`}
                >
                  {channelLabel[ch]}
                </button>
              );
            })}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-[11px] uppercase tracking-wider text-mute">
            Market (country-specific compliance)
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {countries.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => update("country", c)}
                className={`rounded-full px-3 py-1.5 text-sm ${form.country === c ? "bg-signal text-paper" : "border border-line bg-surface"}`}
              >
                {c}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wider text-mute">Founder notes</span>
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
          <button type="submit" className="rounded-full bg-ink px-5 py-2.5 text-sm text-paper">
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
    </div>
  );
}
