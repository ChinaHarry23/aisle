"use client";

import { LlmPicker } from "@/components/settings/LlmPicker";
import { ModelPicker } from "@/components/studio/ModelPicker";
import { formatUsd } from "@/lib/ids";
import { AGENT_SLOTS, LLM_PROVIDERS, assignmentFor, getLlmOrDefault } from "@/lib/llm/catalog";
import { quoteLlm } from "@/lib/llm/estimate";
import type { LlmProviderId } from "@/lib/llm/types";
import { getModelOrDefault } from "@/lib/media/catalog";
import { quoteModel } from "@/lib/media/estimate";
import { useAisle } from "@/lib/store";
import { useEffect, useState } from "react";

type KeyStatus = {
  llm: Record<string, boolean>;
  media: Record<string, boolean>;
};

export default function SettingsPage() {
  const settings = useAisle((s) => s.settings);
  const updateSettings = useAisle((s) => s.updateSettings);
  const [status, setStatus] = useState<KeyStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/settings/status")
      .then((r) => r.json())
      .then((json: KeyStatus) => {
        if (!cancelled) setStatus(json);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const image = getModelOrDefault(settings.imageModelId, "image");
  const video = getModelOrDefault(settings.videoModelId, "video");

  return (
    <div className="flex flex-col gap-10">
      <header className="max-w-2xl">
        <p className="text-[11px] uppercase tracking-[0.2em] text-signal">Workspace</p>
        <h1 className="font-serif text-4xl">Settings.</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          Pick backends once for the whole company. Trend, Compliance, and Media Manager use an LLM
          (local, OpenAI, Claude, or Cursor). Studio posters and ad videos use the media models
          below. Keys stay in <code className="text-xs">.env.local</code> — this page only chooses
          models.
        </p>
      </header>

      <section>
        <p className="text-[11px] uppercase tracking-wider text-mute">Connection</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {LLM_PROVIDERS.map((p) => {
            const live =
              p.id === "local"
                ? Boolean(settings.localBaseUrl) || status?.llm.local
                : status?.llm[p.id];
            return (
              <li key={p.id} className="hairline bg-surface p-4">
                <p className="text-sm font-medium">{p.name}</p>
                <p className="mt-1 text-xs text-mute">{p.blurb}</p>
                <p className={`mt-3 text-[11px] uppercase tracking-wider ${live ? "text-emerald-800" : "text-mute"}`}>
                  {live ? "Configured" : "Stub until keyed"}
                </p>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-mute">Agent backends</p>
            <h2 className="font-serif text-3xl">Who thinks for each seat.</h2>
          </div>
          <label className="text-[11px] uppercase tracking-wider text-mute">
            Apply one backend to all
            <select
              className="mt-1 block min-w-[200px] border border-line bg-surface px-3 py-2 text-sm text-ink"
              defaultValue=""
              onChange={(e) => {
                const provider = e.target.value as LlmProviderId | "";
                if (!provider) return;
                const assignment = assignmentFor(provider);
                updateSettings({
                  agents: {
                    trend: assignment,
                    creative: assignment,
                    compliance: assignment,
                    media: assignment,
                  },
                });
                e.target.value = "";
              }}
            >
              <option value="">Choose…</option>
              {LLM_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {AGENT_SLOTS.map((slot) => {
            const assignment = settings.agents[slot.id];
            const model = getLlmOrDefault(assignment.modelId);
            const quote = quoteLlm(model.id, slot.id);
            return (
              <article key={slot.id} className="hairline bg-surface p-5">
                <p className="text-[11px] uppercase tracking-[0.16em] text-signal">{slot.label}</p>
                <p className="mt-1 font-serif text-2xl">{model.name}</p>
                <p className="text-xs text-mute">
                  {model.provider} · typical call {formatUsd(quote.costUsd)} · {slot.help}
                </p>
                <div className="mt-4">
                  <LlmPicker
                    agent={slot.id}
                    value={assignment}
                    onChange={(next) =>
                      updateSettings({
                        agents: { ...settings.agents, [slot.id]: next },
                      })
                    }
                  />
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="max-w-xl">
        <p className="text-[11px] uppercase tracking-wider text-mute">Local runtime</p>
        <h2 className="font-serif text-3xl">Ollama / LM Studio.</h2>
        <p className="mt-2 text-sm text-ink-soft">
          OpenAI-compatible base URL. Used when an agent is set to Local. Aisle will call{" "}
          <code className="text-xs">/chat/completions</code> from the server — no browser CORS.
        </p>
        <label className="mt-4 block">
          <span className="text-[11px] uppercase tracking-wider text-mute">Base URL</span>
          <input
            value={settings.localBaseUrl}
            onChange={(e) => updateSettings({ localBaseUrl: e.target.value })}
            placeholder="http://127.0.0.1:11434/v1"
            className="mt-1 w-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
          />
        </label>
        <label className="mt-3 block">
          <span className="text-[11px] uppercase tracking-wider text-mute">
            Custom model tag (when “Custom tag” is selected)
          </span>
          <input
            value={settings.localModel}
            onChange={(e) => updateSettings({ localModel: e.target.value })}
            placeholder="llama3.1"
            className="mt-1 w-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
          />
        </label>
      </section>

      <section>
        <p className="text-[11px] uppercase tracking-wider text-mute">Media generation</p>
        <h2 className="font-serif text-3xl">Posters and ad videos.</h2>
        <p className="mt-2 max-w-xl text-sm text-ink-soft">
          Studio generates with these models. Hover a take there for tokens and cost. Estimates are
          Aug 2026 list prices.
        </p>
        <div className="mt-5 grid gap-8 lg:grid-cols-2">
          <div className="hairline bg-surface p-5">
            <p className="text-[11px] uppercase tracking-wider text-mute">Image model</p>
            <p className="mt-1 font-serif text-2xl">{image.name}</p>
            <p className="text-xs text-mute">
              {image.estimateLabel} · {image.blurb}
            </p>
            <div className="mt-4">
              <ModelPicker
                kind="image"
                value={settings.imageModelId}
                onChange={(imageModelId) => updateSettings({ imageModelId })}
              />
            </div>
          </div>
          <div className="hairline bg-surface p-5">
            <p className="text-[11px] uppercase tracking-wider text-mute">Video model</p>
            <p className="mt-1 font-serif text-2xl">{video.name}</p>
            <p className="text-xs text-mute">
              {video.estimateLabel} · {video.blurb}
            </p>
            <label className="mt-3 block text-[11px] uppercase tracking-wider text-mute">
              Default duration
              <select
                value={settings.videoDurationSec}
                onChange={(e) => updateSettings({ videoDurationSec: Number(e.target.value) })}
                className="mt-1 w-full border border-line bg-surface px-2 py-1.5 text-sm text-ink"
              >
                {[4, 6, 8, 12].map((s) => (
                  <option key={s} value={s}>
                    {s}s · {formatUsd(quoteModel(video.id, { durationSec: s }).costUsd)}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-4">
              <ModelPicker
                kind="video"
                value={settings.videoModelId}
                onChange={(videoModelId) => updateSettings({ videoModelId })}
                durationSec={settings.videoDurationSec}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
