/**
 * The poster a campaign run actually renders.
 *
 * Studio's `runGeneration` stays a stub until `adapters.ts` is wired, which is
 * why a campaign used to record copy and then show no picture. This calls the
 * provider that is configured, keeps the founder's product photo as the
 * reference, and stores the bytes. The campaign keeps a short id, not the
 * picture, so the engine response can finish and the image step is saved.
 */
import type { Campaign, Creative } from "@/lib/types";
import { getModel } from "./catalog";
import { runGeneration } from "./generate";
import { posterPrompt, posterRequest } from "./prompts";
import { MEDIA_ADAPTERS, providerKeysSet } from "./providers";
import { referenceImage } from "./providers/frame";
import { rememberAsset } from "./library";
import { putMedia } from "./store";
import { stubGenerate } from "./stub";
import type { MediaGeneration } from "./types";

export async function renderCampaignPoster(input: {
  campaign: Campaign;
  creative: Creative;
  modelId: string;
  ownerId: string;
  /** Key typed in the browser. Never written onto the campaign. */
  userKey?: string;
  /** Founder description of what the current poster got wrong. Used only when the creative agent did not supply a prompt. */
  correction?: string;
  /** Image prompt written by the Image Generation agent for this edit. */
  promptOverride?: string;
  /** The poster already on screen. When set, the provider edits this image instead of the product photo. */
  editFrom?: { bytes: Buffer; mime: string; sha256: string };
}): Promise<MediaGeneration> {
  const req = posterRequest(input.campaign, input.creative, input.modelId, {
    correction: input.correction,
  });
  if (input.promptOverride?.trim()) {
    req.prompt = input.promptOverride.trim();
  } else if (input.correction?.trim() && input.editFrom) {
    req.prompt = posterPrompt(input.campaign, input.creative, {
      correction: input.correction,
      editing: true,
    });
  }
  let model;
  try {
    model = getModel(req.modelId);
  } catch (error) {
    return stubGenerate(req, error instanceof Error ? error.message : "Unknown media model.");
  }
  const adapter = MEDIA_ADAPTERS[model.providerId];
  const key = input.userKey?.trim() || undefined;
  if (!adapter || (!key && !providerKeysSet(adapter))) {
    return runGeneration(req, key);
  }
  try {
    const rendered = await adapter.generate(req, {
      model,
      startImage: input.editFrom ?? referenceImage(req.contextImages),
      apiKey: key,
    });
    const stored = await putMedia({
      ownerId: input.ownerId,
      kind: "image",
      bytes: rendered.bytes,
      mime: rendered.mime,
    });
    await rememberAsset({
      ownerId: input.ownerId,
      kind: "image",
      mediaUrl: stored.url,
      mime: rendered.mime,
      campaignId: input.campaign.id,
      campaignName: input.campaign.name,
      product: input.campaign.product,
      label: input.creative.headline,
      prompt: req.prompt,
      modelId: model.id,
      modelName: model.name,
      creativeId: input.creative.id,
      costUsd: rendered.costUsd,
      costEstimated: /no usage|list estimate/i.test(rendered.note ?? ""),
      inputTokens: rendered.inputTokens,
      outputTokens: rendered.outputTokens,
    }).catch(() => undefined);
    const quoted = stubGenerate(req, `Live ${model.name}`);
    const inputTokens = rendered.inputTokens ?? quoted.usage.inputTokens;
    const outputTokens = rendered.outputTokens ?? quoted.usage.outputTokens;
    return {
      ...quoted,
      status: "ok",
      url: stored.url,
      note: input.editFrom
        ? `Revised on ${model.name}.`
        : input.campaign.productImageUrl
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
