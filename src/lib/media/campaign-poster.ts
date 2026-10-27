/**
 * The poster a campaign run actually renders.
 * The brand's real logo is composited on the image afterwards, so the model does not have to try to draw it.
 */
import { findUserById } from "@/lib/auth/users";
import { billingFor } from "@/lib/billing/meter";
import type { BrandProfile, Campaign, Creative } from "@/lib/types";
import type { BrandInputs } from "./brand-inputs";
import { applyBrandLogo } from "./brand-overlay";
import { ingestBrandCached, loadStoredBrand } from "./brand-resolve";
import { getModel } from "./catalog";
import { failMediaCredits, holdMediaCredits, settleMediaCredits, type MediaHold } from "./credits";
import { runGeneration } from "./generate";
import { posterPrompt, posterRequest } from "./prompts";
import { MEDIA_ADAPTERS, providerKeysSet } from "./providers";
import { referenceImage } from "./providers/frame";
import { rememberAsset } from "./library";
import { putMedia, readMedia } from "./store";
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
  /** The brand to follow. When absent, the owner's stored workspace brand is used. */
  brand?: BrandProfile;
}): Promise<MediaGeneration> {
  // A brand that cannot be read must never stop the render: it goes ahead unbranded and says so.
  let brand: BrandInputs | null = null;
  try {
    const profile = input.brand ?? (await loadStoredBrand(input.ownerId));
    if (profile) {
      brand = await ingestBrandCached(input.ownerId, profile, {
        readStored: (url) => readMedia(url, "image", input.ownerId),
      });
    }
  } catch {
    brand = null;
  }
  const req = posterRequest(input.campaign, input.creative, input.modelId, {
    correction: input.correction,
    // A revision edits a picture that already carries the brand; do not re-theme it.
    brand: input.editFrom || input.promptOverride?.trim() ? null : brand,
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
  const startImage = input.editFrom ?? referenceImage(req.contextImages);
  // A browser key pays the provider only if this adapter really sends it.
  // Otherwise the render runs on the owner's key and the campaign's owner pays
  // in credits, held before the render.
  const callerPays = Boolean(key) && (adapter.callerKeyKinds ?? []).includes(model.kind);
  let held: MediaHold | null = null;
  if (!callerPays) {
    const owner = await findUserById(input.ownerId).catch(() => null);
    const billing = owner ? billingFor(owner) : undefined;
    const outcome = await holdMediaCredits(billing, model, { ...req, contextImages: startImage ? ["reference"] : [] }, input.editFrom ? "poster revision" : "campaign poster");
    if ("refused" in outcome) return stubGenerate(req, outcome.refused);
    held = outcome;
  }
  try {
    let rendered;
    try {
      rendered = await adapter.generate(req, { model, startImage, apiKey: key });
    } catch (error) {
      if (held) await failMediaCredits(held, error);
      throw error;
    }
    if (held) await settleMediaCredits(held, rendered.costUsd);
    // The real logo goes on after the render. If it cannot be placed the picture is still
    // kept, and the result says the logo is missing instead of pretending it is there.
    let final: { bytes: Buffer; mime: string } = { bytes: rendered.bytes, mime: rendered.mime };
    let logoApplied = false;
    const gaps = (brand?.gaps ?? []).map((gap) => gap.reason);
    if (brand?.logo) {
      try {
        const plate = brand.palette.entries.find((entry) => entry.role === "background")?.hex;
        const branded = await applyBrandLogo(final, brand.logo, { plate });
        final = { bytes: branded.bytes, mime: branded.mime };
        logoApplied = true;
      } catch (error) {
        gaps.push(`The brand logo could not be placed on the image: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }
    const stored = await putMedia({
      ownerId: input.ownerId,
      kind: "image",
      bytes: final.bytes,
      mime: final.mime,
    });
    await rememberAsset({
      ownerId: input.ownerId,
      kind: "image",
      mediaUrl: stored.url,
      mime: final.mime,
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
      note: [
        input.editFrom
          ? `Revised on ${model.name}.`
          : input.campaign.productImageUrl
            ? `Live ${model.name}. Built around the uploaded product photo.`
            : `Live ${model.name}.`,
        logoApplied ? "Brand logo added." : brand ? "No brand logo on this image." : "",
      ]
        .filter(Boolean)
        .join(" "),
      brand: brand ? { logoApplied, gaps } : undefined,
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
