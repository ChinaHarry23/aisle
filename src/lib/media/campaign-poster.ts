/**
 * The poster a campaign run actually renders.
 *
 * Studio's `runGeneration` stays a stub until `adapters.ts` is wired, which is
 * why a campaign used to record copy and then show no picture. This calls the
 * provider that is configured, keeps the founder's product photo as the
 * reference, and stores the bytes. The campaign keeps a short id, not the
 * picture, so the engine response can finish and the image step is saved.
 */
import { createHash } from "node:crypto";
import type { Campaign, Creative } from "@/lib/types";
import { getModel } from "./catalog";
import { runGeneration } from "./generate";
import { posterRequest } from "./prompts";
import { MEDIA_ADAPTERS, providerKeysSet } from "./providers";
import type { GenerateRequest, MediaModel as ProviderModel, ProviderId } from "./pr2-types";
import { putMedia } from "./store";
import { stubGenerate } from "./stub";
import type { MediaGeneration } from "./types";

function referenceImage(images: string[] | undefined) {
  const raw = images?.find((item) => item.startsWith("data:image/"));
  if (!raw) return undefined;
  const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(raw);
  if (!match) return undefined;
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (bytes.length < 32 || bytes.length > 4_000_000) return undefined;
  const mime = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  return {
    bytes,
    mime,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function renderCampaignPoster(input: {
  campaign: Campaign;
  creative: Creative;
  modelId: string;
  ownerId: string;
  /** Key typed in the browser. Never written onto the campaign. */
  userKey?: string;
}): Promise<MediaGeneration> {
  const req = posterRequest(input.campaign, input.creative, input.modelId);
  let model;
  try {
    model = getModel(req.modelId);
  } catch (error) {
    return stubGenerate(req, error instanceof Error ? error.message : "Unknown media model.");
  }
  const adapter = MEDIA_ADAPTERS[model.providerId as ProviderId];
  const key = input.userKey?.trim() || undefined;
  if (!adapter || (!key && !providerKeysSet(adapter))) {
    return runGeneration(req, key);
  }
  try {
    const rendered = await adapter.generate(req as GenerateRequest, {
      model: model as ProviderModel,
      startImage: referenceImage(req.contextImages),
      apiKey: key,
    });
    const stored = await putMedia({
      ownerId: input.ownerId,
      kind: "image",
      bytes: rendered.bytes,
      mime: rendered.mime,
    });
    const quoted = stubGenerate(req, `Live ${model.name}`);
    const inputTokens = rendered.inputTokens ?? quoted.usage.inputTokens;
    const outputTokens = rendered.outputTokens ?? quoted.usage.outputTokens;
    return {
      ...quoted,
      status: "ok",
      url: stored.url,
      note: input.campaign.productImageUrl
        ? `Live ${model.name}. Built around the uploaded product photo.`
        : `Live ${model.name}.`,
      usage: {
        ...quoted.usage,
        costUsd: rendered.costUsd,
        estimate: false,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
    };
  } catch (error) {
    return stubGenerate(req, error instanceof Error ? error.message : "Image generation failed.");
  }
}
