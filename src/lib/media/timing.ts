import type { MediaGeneration } from "./pr2-types";

/** Recorded request latency includes queueing/loading/rendering, not campaign import. */
export function generationTiming(generation?: MediaGeneration) {
  const successful = generation?.status === "ok" && Boolean(generation.url);
  const ms = generation?.usage?.latencyMs;
  const durationMs = successful && typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? ms : null;
  const timestamp = successful && generation?.at ? Date.parse(generation.at) : NaN;
  const completedAt = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  return { durationMs, completedAt };
}

export function formatGenerationDuration(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "Not recorded";
  if (ms < 1000) return "<1s";
  const seconds = Math.round(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(remainder).padStart(2, "0")}s`;
  if (minutes) return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
  return `${remainder}s`;
}

/** Explicit timezone keeps server and browser rendering consistent. */
export function formatGenerationDate(iso: string) {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(iso));
}

export function formatClipDuration(seconds: number) {
  return Number.isFinite(seconds) && seconds > 0 ? `${Number(seconds.toFixed(2))}s` : "Not recorded";
}
