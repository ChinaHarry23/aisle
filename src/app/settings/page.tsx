"use client";

import { LlmPicker, seatCostLabel } from "@/components/settings/LlmPicker";
import { ModelPicker } from "@/components/studio/ModelPicker";
import { BACKENDS, applyBackend, currentBackend, getBackend, type BackendId } from "@/lib/backends";
import { creditsForCost } from "@/lib/billing/plan";
import { formatUsd } from "@/lib/ids";
import { AGENT_SLOTS, LLM_PROVIDERS, LOCAL_DEFAULT_LLM, UNAVAILABLE_LLM_PROVIDERS, getLlmOrDefault } from "@/lib/llm/catalog";
import { campaignVideoDurations, getModel, getModelOrDefault, snapCampaignDuration } from "@/lib/media/catalog";
import { quoteModel } from "@/lib/media/estimate";
import { useAisle } from "@/lib/store";
import { useEffect, useState } from "react";

type KeyStatus = {
  llm: Record<string, boolean>;
  media: Record<string, boolean>;
  runtime?: { localBase: string; localModel: string | null; comfy: boolean };
};

// Stray whitespace is trimmed by the adapter too, so it is not a mismatch.
const trimUrl = (url: string) => url.trim().replace(/\/$/, "");
const hostOf = (url: string) => trimUrl(url).replace(/^https?:\/\//, "").replace(/\/v1$/, "");

const localBackend = getBackend("local");
const cloudBackends = BACKENDS.filter((b) => b.where === "cloud");
// The cloud backends share one poster and one video model.
const cloudMedia = cloudBackends[0];

export default function SettingsPage() {
  const settings = useAisle((s) => s.settings);
  const updateSettings = useAisle((s) => s.updateSettings);
  const [status, setStatus] = useState<KeyStatus | "error" | null>(null);
  const keys = status === "error" ? null : status;

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/settings/status")
      .then((r) => {
        if (!r.ok) throw new Error(`status ${r.status}`);
        return r.json();
      })
      .then((json: KeyStatus) => {
        if (!cancelled) setStatus(json);
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const image = getModelOrDefault(settings.imageModelId, "image");
  const video = getModelOrDefault(settings.videoModelId, "video");
  const duration = snapCampaignDuration(video, settings.videoDurationSec);
  const now = currentBackend(settings);
  // Say so on the Local option when this server's local runtime is not answering.
  const runtime = keys?.runtime;
  const localDown = !runtime
    ? ""
    : !runtime.localModel && !runtime.comfy
      ? " (local LLM and ComfyUI not answering)"
      : !runtime.localModel
        ? " (local LLM not answering)"
        : !runtime.comfy
          ? " (ComfyUI not answering)"
          : "";
  const nowLabel =
    now === null
      ? "mixed — seats and media differ"
      : now === "local"
        ? "Local — everything on this Mac"
        : `Cloud · ${getBackend(now).name}`;

  return (
    <div className="flex flex-col gap-10">
      <header className="max-w-2xl">
        <p className="text-[11px] uppercase tracking-[0.2em] text-signal">Workspace</p>
        <h1 className="font-serif text-4xl">Settings.</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          Pick backends once for the whole company. All four agents use an LLM — Local (Qwen3.8 on
          MTPLX), OpenAI or Claude. Studio posters and ad videos use the media models below. Local
          is free. Cloud models run on Aisle&apos;s own keys and are paid in credits, so there is
          nothing to paste here.
        </p>
      </header>

      <section>
        <p className="text-[11px] uppercase tracking-wider text-mute">Connection</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {LLM_PROVIDERS.map((p) => {
            if (p.id === "local") {
              const served = runtime?.localModel;
              const seats = AGENT_SLOTS.map((slot) => settings.agents[slot.id]);
              const qwen = getLlmOrDefault(LOCAL_DEFAULT_LLM);
              // A blank field follows the server's LOCAL_LLM_BASE_URL; with none set, Local seats stub.
              const seatUrl = trimUrl(settings.localBaseUrl) || (keys?.llm.local && runtime ? runtime.localBase : "");
              const localSeats = seats.some((seat) => seat.provider === "local");
              // The probe only checks the server's URL; say so when the seats call another.
              const elsewhere = runtime && localSeats && seatUrl !== runtime.localBase;
              const wrongModel =
                !elsewhere && served && seats.some((seat) => seat.modelId === qwen.id) && served !== qwen.apiModel;
              return (
                <li key={p.id} className="hairline bg-surface p-4">
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="mt-1 text-xs text-mute">{p.blurb}</p>
                  <p className={`mt-3 break-words text-[11px] uppercase tracking-wider ${served ? "text-emerald-800" : "text-mute"}`}>
                    {status === null
                      ? "Checking…"
                      : !runtime
                        ? "Status unavailable"
                        : served
                          ? `LLM · ${served} · ${hostOf(runtime.localBase)}`
                          : `LLM not answering · ${hostOf(runtime.localBase)}`}
                  </p>
                  {runtime && (
                    <p className={`mt-1 text-[11px] uppercase tracking-wider ${runtime.comfy ? "text-emerald-800" : "text-mute"}`}>
                      {runtime.comfy ? "ComfyUI answering" : "ComfyUI not answering"}
                    </p>
                  )}
                  {elsewhere && (
                    <p className="mt-2 break-words text-xs text-signal">
                      {seatUrl
                        ? `Local seats call ${hostOf(seatUrl)} — not checked here.`
                        : "Local seats have no URL, so they fall back to the simulator."}
                    </p>
                  )}
                  {wrongModel && (
                    <p className="mt-2 break-words text-xs text-signal">
                      {qwen.name} seats ask for {qwen.apiModel}; this server has {served}.
                    </p>
                  )}
                </li>
              );
            }
            const live = keys?.llm[p.id];
            return (
              <li key={p.id} className="hairline bg-surface p-4">
                <p className="text-sm font-medium">{p.name}</p>
                <p className="mt-1 text-xs text-mute">{p.blurb}</p>
                <p className={`mt-3 text-[11px] uppercase tracking-wider ${live ? "text-emerald-800" : "text-mute"}`}>
                  {status === null ? "Checking…" : live ? "Included with credits" : "Not available"}
                </p>
              </li>
            );
          })}
          {UNAVAILABLE_LLM_PROVIDERS.map((p) => (
            <li key={p.id} className="hairline bg-surface p-4 opacity-60">
              <p className="text-sm font-medium">{p.name}</p>
              <p className="mt-1 text-xs text-mute">{p.reason}</p>
              <p className="mt-3 text-[11px] uppercase tracking-wider text-mute">Not available</p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-mute">Agent backends</p>
            <h2 className="font-serif text-3xl">Who thinks for each seat.</h2>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-mute">
              Apply one backend to all
              <select
                className="mt-1 block min-w-[240px] border border-line bg-surface px-3 py-2 text-sm normal-case tracking-normal text-ink"
                defaultValue=""
                onChange={(e) => {
                  const id = e.target.value as BackendId | "";
                  if (!id) return;
                  updateSettings(applyBackend(settings, id, keys?.runtime?.localBase));
                  e.target.value = "";
                }}
              >
                <option value="">Choose…</option>
                <optgroup label="This Mac">
                  <option value={localBackend.id}>
                    {localBackend.name} — Qwen3.8 + ComfyUI{localDown}
                  </option>
                </optgroup>
                <optgroup label="Cloud">
                  {cloudBackends.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <p className="mt-1 text-[11px] text-mute">Now: {nowLabel}</p>
            {localDown && (
              <p className="mt-1 max-w-[240px] text-[11px] text-signal">
                Local{localDown}: those seats fall back to rules and Studio renders fail until it starts.
              </p>
            )}
          </div>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-soft">
          <span className="text-ink">Local</span> puts all four seats on{" "}
          {getLlmOrDefault(localBackend.llmModelId).name} (MTPLX) and Studio on ComfyUI —{" "}
          {getModel(localBackend.imageModelId).name} posters, {getModel(localBackend.videoModelId).name}{" "}
          ad videos. <span className="text-ink">Cloud</span> puts the seats on that provider and
          Studio on {getModel(cloudMedia.imageModelId).name} and{" "}
          {getModel(cloudMedia.videoModelId).name}. Cloud seats and renders use credits; when
          credits run out, agents fall back to a local model or their built-in rules and posters
          render on ComfyUI.
        </p>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {AGENT_SLOTS.map((slot) => {
            const assignment = settings.agents[slot.id];
            const model = getLlmOrDefault(assignment.modelId);
            return (
              <article key={slot.id} className="hairline bg-surface p-5">
                <p className="text-[11px] uppercase tracking-[0.16em] text-signal">{slot.label}</p>
                <p className="mt-1 font-serif text-2xl">{model.name}</p>
                <p className="text-xs text-mute">
                  {model.provider} · typical call {seatCostLabel(model, slot.id)} · {slot.help}
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
        <h2 className="font-serif text-3xl">MTPLX, Ollama or LM Studio.</h2>
        <p className="mt-2 text-sm text-ink-soft">
          OpenAI-compatible base URL. Used when an agent is set to Local. MTPLX serves Qwen3.8 on
          port 8000 — start it with <code className="text-xs">mtplx quickstart --port 8000</code>.
          Aisle will call <code className="text-xs">/chat/completions</code> from the server — no
          browser CORS. Only loopback addresses (127.0.0.1, localhost) are accepted, and a hosted
          Aisle ignores this field and uses its own configured server.
        </p>
        <label className="mt-4 block">
          <span className="text-[11px] uppercase tracking-wider text-mute">Base URL</span>
          <input
            value={settings.localBaseUrl}
            onChange={(e) => updateSettings({ localBaseUrl: e.target.value })}
            placeholder="http://127.0.0.1:8000/v1"
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
            placeholder="mtplx-flash-next-optimized-speed"
            className="mt-1 w-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
          />
        </label>
      </section>

      <section>
        <p className="text-[11px] uppercase tracking-wider text-mute">Media generation</p>
        <h2 className="font-serif text-3xl">Posters and ad videos.</h2>
        <p className="mt-2 max-w-xl text-sm text-ink-soft">
          Studio generates with these models. Cloud renders cost credits (twice the provider&apos;s
          price); ComfyUI on this Mac is free. Hover a take there for tokens and cost. Estimates are
          Sep 2026 list prices.
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
                value={duration}
                onChange={(e) => updateSettings({ videoDurationSec: Number(e.target.value) })}
                className="mt-1 w-full border border-line bg-surface px-2 py-1.5 text-sm text-ink"
              >
                {/* Only lengths this model can render, the same list Studio and the server use. */}
                {campaignVideoDurations(video).map((s) => {
                  const cost = quoteModel(video.id, { durationSec: s }).costUsd;
                  return (
                    <option key={s} value={s}>
                      {s}s{s === 30 ? " complete story ad" : " test clip"} · {cost > 0 ? `${formatUsd(cost)} · ${creditsForCost(cost)} credits` : "Free"}
                    </option>
                  );
                })}
              </select>
            </label>
            <div className="mt-4">
              <ModelPicker
                kind="video"
                value={settings.videoModelId}
                onChange={(videoModelId) =>
                  updateSettings({
                    videoModelId,
                    // Keep the saved default a length the new model can render.
                    videoDurationSec: snapCampaignDuration(getModelOrDefault(videoModelId, "video"), settings.videoDurationSec),
                  })
                }
                durationSec={duration}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
