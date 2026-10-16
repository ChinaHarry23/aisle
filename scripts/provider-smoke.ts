/**
 * LIVE provider smoke test. The owner runs this with real keys before turning a
 * media provider on; it spends a few cents per provider (images) and more with
 * --video. It is never part of the offline suites.
 *
 *   node --env-file-if-exists=.env.local --import ./scripts/service-loader.mjs \
 *     --experimental-strip-types scripts/provider-smoke.ts --live [--video] [--provider=google] [--save] [--out=dir]
 *
 * For every adapter in MEDIA_ADAPTERS whose keys are set, it makes the cheapest
 * real call (lowest quality, smallest size; the shortest low-resolution clip
 * only with --video), checks the bytes are a real image or MP4, prints PASS or
 * FAIL, and writes docs/evidence/provider-smoke-<ISO>.json. The evidence never
 * contains a key or a provider file link. --save also keeps the returned media.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MEDIA_ADAPTERS, providerAvailability, providerKeysSet } from "../src/lib/media/providers";
import { MEDIA_MODELS } from "../src/lib/media/catalog";
import { quoteModel } from "../src/lib/media/estimate";
import { assertMediaBytes, sha256Hex } from "../src/lib/media/store";
import { mp4DurationSec } from "../src/lib/media/providers/http";
import type { MediaKind, MediaModel, ProviderId } from "../src/lib/media/pr2-types";

const args = new Set(process.argv.slice(2));
const flag = (name: string) => process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const only = flag("provider");

if (!args.has("--live")) {
  console.error([
    "Refusing to run: this smoke test calls real provider APIs on the owner's keys and costs money.",
    "Re-run with --live to confirm (add --video to include one short clip per provider, about $0.40–0.60 each).",
    "The offline tests are `scripts/cloud-media-suite.ts` and `scripts/provider-adapters-suite.ts`.",
  ].join("\n"));
  process.exit(2);
}

type Evidence = {
  provider: ProviderId;
  modelId: string;
  apiModel: string;
  kind: MediaKind;
  ok: boolean;
  skipped?: string;
  ms?: number;
  mime?: string;
  bytes?: number;
  sha256?: string;
  costUsd?: number;
  jobId?: string;
  durationSec?: number;
  aspect?: string;
  error?: string;
};

/** Cheapest model of a kind for a provider, skipping ones already scheduled to shut down. */
function cheapest(providerId: ProviderId, kind: MediaKind): MediaModel | undefined {
  const candidates = MEDIA_MODELS.filter((m) => m.providerId === providerId && m.kind === kind) as MediaModel[];
  const live = candidates.filter((m) => !m.sunset);
  const pool = live.length ? live : candidates;
  const seconds = (m: MediaModel) => m.durations?.[0] ?? 4;
  return pool.sort((a, b) => quoteModel(a.id, { durationSec: seconds(a) }).costUsd - quoteModel(b.id, { durationSec: seconds(b) }).costUsd)[0];
}

/** Strip anything that looks like a credential or link from an error before it is printed or saved. */
function clean(message: string) {
  return message.replace(/https?:\/\/\S+/g, "<url>").replace(/(sk-|AIza)[\w-]{8,}/g, "<redacted>").slice(0, 400);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.resolve(flag("out") ?? "docs/evidence");
const results: Evidence[] = [];
const startFrames: { bytes: Buffer; mime: string; sha256: string }[] = [];

for (const [id, adapter] of Object.entries(MEDIA_ADAPTERS) as [ProviderId, NonNullable<(typeof MEDIA_ADAPTERS)[ProviderId]>][]) {
  if (only && only !== id) continue;
  const kinds: MediaKind[] = args.has("--video") ? ["image", "video"] : ["image"];
  for (const kind of kinds) {
    const model = cheapest(id, kind);
    if (!model) continue;
    const base: Evidence = { provider: id, modelId: model.id, apiModel: model.apiModel, kind, ok: false };
    if (!providerKeysSet(adapter)) {
      results.push({ ...base, skipped: `key not set (${adapter.keyEnv.join(", ")})` });
      console.log(`SKIP ${id} ${kind}: key not set`);
      continue;
    }
    const startImage = kind === "video" ? startFrames[0] : undefined;
    if (kind === "video" && !startImage) {
      results.push({ ...base, skipped: "no start frame: every image call failed" });
      console.log(`SKIP ${id} video: no start frame`);
      continue;
    }
    const durationSec = model.durations?.[0] ?? 4;
    const started = Date.now();
    try {
      const out = await adapter.generate(
        { kind, modelId: model.id, prompt: kind === "image" ? "A single red apple on a plain white table, soft daylight, product photo." : "The apple slowly rotates; gentle daylight; one continuous shot.", aspectRatio: kind === "image" ? "1:1" : "9:16", quality: "low", durationSec: kind === "video" ? durationSec : undefined },
        { model, startImage, onQueued: (jobId) => console.log(`  … ${id} ${kind} queued (${jobId.split(":").slice(0, 2).join(":")})`) },
      );
      const mime = assertMediaBytes(out.bytes, kind, out.mime);
      const evidence: Evidence = { ...base, ok: true, ms: Date.now() - started, mime, bytes: out.bytes.length, sha256: sha256Hex(out.bytes), costUsd: out.costUsd, jobId: out.jobId.split(":").slice(0, 2).join(":"), durationSec: kind === "video" ? mp4DurationSec(out.bytes) ?? out.durationSec : undefined, aspect: out.aspect };
      results.push(evidence);
      if (kind === "image") startFrames.push({ bytes: out.bytes, mime, sha256: evidence.sha256! });
      if (args.has("--save")) {
        const mediaDir = path.join(outDir, `provider-smoke-${stamp}`);
        mkdirSync(mediaDir, { recursive: true });
        writeFileSync(path.join(mediaDir, `${id}-${kind}.${mime.split("/")[1]}`), out.bytes);
      }
      console.log(`PASS ${id} ${kind} ${model.id}: ${mime}, ${(out.bytes.length / 1024).toFixed(0)} KB, $${out.costUsd.toFixed(4)}, ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } catch (error) {
      const message = clean(error instanceof Error ? error.message : String(error));
      results.push({ ...base, ms: Date.now() - started, error: message });
      console.log(`FAIL ${id} ${kind} ${model.id}: ${message}`);
    }
  }
}

mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `provider-smoke-${stamp}.json`);
const report = {
  ranAt: new Date().toISOString(),
  node: process.version,
  video: args.has("--video"),
  // Which API origin each provider was pointed at, to show the run hit the real service.
  apiOrigins: {
    openai: new URL(process.env.OPENAI_API_BASE || "https://api.openai.com/v1").origin,
    google: new URL(process.env.GOOGLE_API_BASE || "https://generativelanguage.googleapis.com/v1beta").origin,
    bytedance: new URL(process.env.ARK_API_BASE || "https://ark.ap-southeast.bytepluses.com/api/v3").origin,
    tencent: new URL(process.env.TOKENHUB_API_BASE || "https://tokenhub-intl.tencentcloudmaas.com").origin,
    alibaba: new URL(process.env.DASHSCOPE_API_BASE || "https://dashscope-intl.aliyuncs.com/api/v1").origin,
  },
  availability: (Object.keys(MEDIA_ADAPTERS) as ProviderId[]).map(providerAvailability),
  totalCostUsd: Math.round(results.reduce((n, r) => n + (r.costUsd ?? 0), 0) * 10000) / 10000,
  results,
};
writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
const failed = results.filter((r) => !r.ok && !r.skipped).length;
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed} passed, ${failed} failed, ${results.length - passed - failed} skipped · spent about $${report.totalCostUsd.toFixed(4)} · evidence ${path.relative(process.cwd(), file)}`);
process.exit(failed ? 1 : 0);
