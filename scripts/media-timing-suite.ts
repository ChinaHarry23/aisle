/** Offline metadata/UI tests. No model calls or account mutations. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatClipDuration, formatGenerationDate, formatGenerationDuration, generationTiming } from "../src/lib/media/timing";
import type { MediaGeneration } from "../src/lib/media/types";

const generation: MediaGeneration = {
  kind: "video", modelId: "comfy:minimax-h3", provider: "ComfyUI", modelName: "MiniMax H3",
  status: "ok", url: "http://fixture/video.mp4", note: "Offline fixture", at: "2026-09-29T14:35:54.703Z",
  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, units: 1, unitLabel: "video", costUsd: 0, billedAs: "fixture", estimate: false, latencyMs: 2276274 },
};
assert.equal(formatGenerationDuration(60164), "1m 00s");
assert.equal(formatGenerationDuration(91720), "1m 32s");
assert.equal(formatGenerationDuration(2276274), "37m 56s");
assert.equal(formatGenerationDuration(3599600), "1h 00m 00s");
assert.equal(formatGenerationDuration(450), "<1s");
assert.equal(formatGenerationDuration(5000), "5s");
for (const duration of [null, undefined, 0, -1, NaN, Infinity]) assert.equal(formatGenerationDuration(duration), "Not recorded");
assert.equal(formatClipDuration(5.166667), "5.17s");
assert.equal(formatClipDuration(NaN), "Not recorded");
console.log("PASS actual request timings, clip length, rounding and unavailable durations");

assert.deepEqual(generationTiming(generation), { durationMs: 2276274, completedAt: generation.at });
assert.deepEqual(generationTiming(), { durationMs: null, completedAt: null });
assert.deepEqual(generationTiming({ ...generation, url: undefined }), { durationMs: null, completedAt: null });
assert.deepEqual(generationTiming({ ...generation, status: "stubbed" }), { durationMs: null, completedAt: null });
assert.equal(generationTiming({ ...generation, at: "invalid" }).completedAt, null);
assert.equal(generationTiming({ ...generation, usage: { ...generation.usage, latencyMs: 0 } }).durationMs, null);
const completed = formatGenerationDate(generation.at);
assert.match(completed, /30 Sept? 2026/);
assert.match(completed, /00:35:54/);
console.log("PASS only successful attached assets show timing; completion uses explicit Sydney timezone");

const dir = mkdtempSync(path.join(os.tmpdir(), "aisle-timing-test-"));
const require = createRequire(import.meta.url);
const source = readFileSync("src/components/studio/GenerationInfo.tsx", "utf8");
let compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
compiled = compiled.replaceAll('from "react/jsx-runtime"', `from "${pathToFileURL(require.resolve("react/jsx-runtime")).href}"`);
compiled = compiled.replaceAll('from "@/lib/media/timing"', `from "${pathToFileURL(path.resolve("src/lib/media/timing.ts")).href}"`);
const moduleFile = path.join(dir, "GenerationInfo.mjs");
writeFileSync(moduleFile, compiled);
const { GenerationInfo } = await import(pathToFileURL(moduleFile).href);
const render = (props: { generation?: MediaGeneration; clipDurationSec?: number }) => renderToStaticMarkup(createElement(GenerationInfo, props));
const video = render({ generation, clipDurationSec: 5.166667 });
assert.match(video, /aria-label="Generation information"/);
assert.match(video, /37m 56s/);
assert.match(video, /Video length/);
assert.match(video, /5.17s/);
assert.match(video, /dateTime="2026-09-29T14:35:54.703Z"/i);
assert.match(video, /Completed \(Sydney time\)/);
assert.match(video, /queueing, model loading and rendering/);
assert.match(video, /Earlier failed attempts and later saving are excluded/);
const poster = render({ generation: { ...generation, kind: "image", modelName: "Image fixture", usage: { ...generation.usage, latencyMs: 60164 } } });
assert.match(poster, /1m 00s/);
assert.match(poster, /Image fixture/);
assert.doesNotMatch(poster, /Video length/);
assert.match(render({}), /No successfully generated asset is attached/);
assert.match(render({ generation: { ...generation, usage: { ...generation.usage, latencyMs: 0 } } }), /no recorded generation duration/);
const edited = render({ generation: { ...generation, composition: { renderMs: 60164, editingMs: 1000, reusedClips: 1, shots: [] } }, clipDurationSec: 30 });
assert.match(edited, /Production time/);
assert.match(edited, /30s/);
assert.match(edited, /excludes the earlier rendering of 1 reused clip/);
assert.match(edited, /interrupted attempts and idle time between runs/);
console.log("PASS rendered poster/video metadata, ISO completion date, timing scope and honest missing-data labels");

const directed = render({ generation: { ...generation, artDirection: {
  version: "offline-artist-test", title: "OFFLINE concept", sellingIdea: "Fixture selling idea", hook: "Fixture hook",
  story: { setup: "Setup fixture", development: "Development fixture", payoff: "Payoff fixture" },
  continuity: { subject: "Hands", product: "Glass", environment: "Surface", lighting: "Window", screenDirection: "Left to right", visibleRecurringFace: false },
  prompt: "Offline prompt", shots: [{ label: "Fixture shot", beat: "setup", entryState: "Full glass", exitState: "Glass lifted", prompt: "Explicit fixture action" }],
  closing: { headline: "Fixture", cta: "Explore" }, reviewNotes: ["Offline only; not real AI output"], styleReference: "Offline supplied reference",
  author: { providerId: "local", provider: "Local", modelId: "local:custom", modelName: "OFFLINE planner", status: "ok", text: null, note: "Offline only", at: generation.at, usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, costUsd: 0.0015, estimate: false, billedAs: "fixture", latencyMs: 2000 } },
} }, clipDurationSec: 30 });
for (const text of ["AI art direction and story", "Fixture selling idea", "Setup fixture", "Development fixture", "Payoff fixture", "OFFLINE planner", "2s", "$0.0015", "Shot continuity and prompts", "Entry: Full glass", "Exit: Glass lifted", "Explicit fixture action", "Offline supplied reference", "Offline only; not real AI output"]) assert(directed.includes(text), text);
assert.doesNotMatch(video, /AI art direction and story/, "old assets must not claim an agent-authored plan retroactively");
console.log("PASS rendered artist concept, story, per-shot continuity/prompt, separate planning timing/cost and reference provenance");
