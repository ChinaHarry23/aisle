import { holdCredits, holdOrThrow, releaseHold, settleHold, type BillingContext, type Hold } from "@/lib/billing/meter";
import { generateComfyImage, generateComfyVideo } from "./comfy";
import { generateLtxVideo } from "./ltx";
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, getModel } from "./catalog";
import { estimateUsage, holdEstimateUsd } from "./estimate";
import { MEDIA_ADAPTERS, usableProvider, type ProviderOutput } from "./providers";
import { ProviderError } from "./providers/http";
import { putMedia, readMedia } from "./store";
import type { GenerateRequest, GenerateResult, MediaModel } from "./types";

export { holdEstimateUsd };

/**
 * The model a request actually renders on. A cloud model whose provider is not
 * usable here (no adapter, no key, or not allowlisted) falls back to local
 * ComfyUI, so that is what gets quoted against the budget.
 */
export function renderingModel(req: Pick<GenerateRequest, "kind" | "modelId">): MediaModel {
  const model = getModel(req.modelId);
  if (model.providerId === "comfy" && model.kind === req.kind) return model;
  if (model.providerId !== "comfy" && model.kind === req.kind && usableProvider(model.providerId)) return model;
  return getModel(req.kind === "video" ? DEFAULT_VIDEO_MODEL : DEFAULT_IMAGE_MODEL);
}

/** A result with nothing attached (and, unless `costUsd` says otherwise, nothing spent). */
function emptyResult(req: GenerateRequest, model: MediaModel, status: GenerateResult["status"], note: string, latencyMs = 0, extra: { costUsd?: number; promptId?: string } = {}): GenerateResult {
  return {
    kind: req.kind,
    modelId: model.id,
    provider: model.provider,
    modelName: model.name,
    status,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, units: 0, unitLabel: req.kind === "video" ? "sec" : "poster", costUsd: extra.costUsd ?? 0, billedAs: extra.costUsd ? "failed after submission" : "not run", latencyMs, estimate: Boolean(extra.costUsd) },
    url: null,
    note,
    at: new Date().toISOString(),
    // The provider's job id, so the owner can reconcile a job that was billed but never delivered.
    ...(extra.promptId ? { promptId: extra.promptId } : {}),
  };
}

const logLedger = (what: string) => (error: unknown) => console.error(what, error instanceof Error ? error.message : error);

async function runLocal(req: GenerateRequest, onQueued?: (promptId: string) => void): Promise<GenerateResult> {
  const requested = getModel(req.modelId);
  const local = requested.providerId === "comfy" && requested.kind === req.kind ? requested : getModel(req.kind === "video" ? DEFAULT_VIDEO_MODEL : DEFAULT_IMAGE_MODEL);
  const localReq = { ...req, modelId: local.id };
  const result = local.id === "comfy:ltx-2.5" ? await generateLtxVideo(localReq, onQueued) : req.kind === "video" ? await generateComfyVideo(localReq, onQueued) : await generateComfyImage(localReq, onQueued);
  return { ...result, aspect: result.aspect ?? req.aspectRatio ?? "4:5" };
}

/**
 * Render one poster or clip.
 *
 * Local ComfyUI is free and never metered. A cloud model holds credits for the
 * quote, calls the provider's adapter, stores the bytes, then settles the real
 * cost. A failure before or at submission, or one the provider says it does not
 * bill (failed, cancelled, moderated), releases the hold. A failure after the
 * job was accepted (deadline, polling or download gave out) settles the list
 * estimate, because the provider may still bill it; a store failure after the
 * provider delivered settles the real cost. `signal` stops waiting on the
 * provider (the Studio sets it inside its function limit).
 *
 * When the caller cannot pay (no billing context, or not enough credits) the
 * call never leaves the server: `strict`
 * throws InsufficientCreditsError (the Studio turns it into a 402), otherwise the
 * take renders locally, or comes back `no_credits` when ComfyUI is down too.
 */
export async function runGeneration(
  req: GenerateRequest,
  onQueued?: (promptId: string) => void,
  billing?: BillingContext,
  options: { strict?: boolean; signal?: AbortSignal } = {},
): Promise<GenerateResult> {
  const requested = getModel(req.modelId);
  const model = renderingModel(req);

  if (model.providerId === "comfy") {
    try {
      return await runLocal(req, onQueued);
    } catch (err) {
      return emptyResult(req, model, "stubbed", err instanceof Error ? err.message : "ComfyUI error");
    }
  }

  const adapter = MEDIA_ADAPTERS[model.providerId]!;
  const ownerId = req.ownerId ?? (billing?.kind === "user" ? billing.userId : undefined);
  const holdUsd = holdEstimateUsd(model, req);
  const hold: Hold | null = options.strict ? await holdOrThrow(billing, holdUsd) : await holdCredits(billing, holdUsd);
  if (!hold) {
    try {
      const local = await runLocal(req, onQueued);
      return { ...local, note: `Out of credits — rendered locally. ${local.note}` };
    } catch (err) {
      return emptyResult(req, requested, "no_credits", `Out of credits — ${model.name} was not called, and local ComfyUI is unavailable (${err instanceof Error ? err.message : "error"}). Subscribe on Billing for cloud renders.`);
    }
  }

  const started = Date.now();
  let jobId: string | undefined;
  let startImage: Awaited<ReturnType<typeof readMedia>> | undefined;
  let out: ProviderOutput;
  try {
    if (!ownerId) throw new Error("Cloud media needs an owning account to store the result.");
    // Hash exactly the bytes the provider is sent; that hash is the video's provenance.
    startImage = req.kind === "video"
      ? req.startImageUrl ? await readMedia(req.startImageUrl, "image", ownerId) : undefined
      : undefined;
    if (req.kind === "video" && !startImage && model.videoInput !== "text") throw new Error("Image-to-video requires a generated campaign image.");
    out = await adapter.generate(req, {
      model,
      startImage,
      onQueued: (id) => { jobId = id; onQueued?.(id); },
      signal: options.signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Provider error";
    if (err instanceof ProviderError && err.billable) {
      // The job was accepted and may still be billed to the owner: charge the list estimate.
      const estimate = estimateUsage(model, req).costUsd;
      await settleHold(hold, estimate, { modelId: model.id, note: `${model.name} ${req.kind} (unfinished; provider may bill${jobId ? ` ${jobId}` : ""})` }).catch(logLedger("Credit settlement failed"));
      return emptyResult(req, model, "error", `${message} The provider may still bill this job, so its list estimate is charged.`, Date.now() - started, { costUsd: estimate, promptId: jobId });
    }
    await releaseHold(hold).catch(logLedger("Credit release failed"));
    return emptyResult(req, model, "error", message, Date.now() - started, { promptId: jobId });
  }

  let stored: { url: string };
  try {
    stored = await putMedia({ ownerId, kind: req.kind, bytes: out.bytes, mime: out.mime });
  } catch (err) {
    // The provider delivered and billed; only Aisle's own store failed.
    await settleHold(hold, out.costUsd, { modelId: model.id, note: `${model.name} ${req.kind} (delivered, not stored)` }).catch(logLedger("Credit settlement failed"));
    return emptyResult(req, model, "error", `${model.name} finished but the result could not be stored (${err instanceof Error ? err.message : "store error"}).`, Date.now() - started, { costUsd: out.costUsd, promptId: out.jobId });
  }
  const seconds = out.durationSec ?? req.durationSec ?? 8;
  const inputTokens = out.inputTokens ?? 0;
  const outputTokens = out.outputTokens ?? 0;
  const note = `Live ${model.name}${out.note ? ` · ${out.note}` : ""}`;
  // The render exists and is stored; a ledger hiccup must not throw it away.
  await settleHold(hold, out.costUsd, { modelId: model.id, note: `${model.name} ${req.kind}` }).catch(logLedger("Credit settlement failed"));
  return {
    kind: req.kind,
    modelId: model.id,
    provider: model.provider,
    modelName: model.name,
    status: "ok",
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      units: req.kind === "video" ? seconds : 1,
      unitLabel: req.kind === "video" ? "sec" : "poster",
      costUsd: out.costUsd,
      billedAs: req.kind === "video" ? `${model.name} · ${seconds}s · provider usage` : `${model.name} · provider usage`,
      latencyMs: Date.now() - started,
      estimate: false,
    },
    url: stored.url,
    note,
    at: new Date().toISOString(),
    promptId: out.jobId,
    aspect: out.aspect ?? req.aspectRatio,
    ...(req.kind === "video" && model.videoInput === "text" && !startImage ? { videoMode: "text-to-video" as const } : {}),
    ...(startImage ? { videoMode: "image-to-video" as const, sourceImageUrl: req.startImageUrl, inputImageSha256: startImage.sha256 } : {}),
  };
}
