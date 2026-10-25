import type { BillingContext } from "@/lib/billing/meter";
import { AdapterNotWiredError, callProvider, canRender, isProviderConfigured } from "./adapters";
import { getModel } from "./catalog";
import { failMediaCredits, holdMediaCredits, settleMediaCredits, type MediaHold } from "./credits";
import { stubGenerate } from "./stub";
import type { GenerateRequest, GenerateResult } from "./types";

/**
 * One Studio render. A key typed in the browser pays the provider directly.
 * Otherwise the render runs on the owner's key, so the account named by
 * `billing` must hold credits for the quote first. With no billing context
 * nothing goes out on the owner's key.
 */
export async function runGeneration(
  req: GenerateRequest,
  userKey?: string,
  billing?: BillingContext,
): Promise<GenerateResult> {
  let model;
  try {
    model = getModel(req.modelId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown media model.";
    return stubGenerate(req, reason);
  }
  const configured = Boolean(userKey) || isProviderConfigured(model.envKeys);

  if (!configured) {
    return stubGenerate(
      req,
      `Studio stub — set ${model.envKeys.join(", ")} then fill in adapters.ts to bill this for real.`,
    );
  }

  let held: MediaHold | null = null;
  if (!userKey && canRender(model, req)) {
    const outcome = await holdMediaCredits(billing, model, req, "Studio render");
    if ("refused" in outcome) return stubGenerate(req, outcome.refused);
    held = outcome;
  }

  try {
    const live = await callProvider(model, req, userKey);
    if (held) await settleMediaCredits(held, live.costUsd);
    const stub = stubGenerate(req, "Live URL attached.");
    return {
      ...stub,
      status: "ok",
      url: live.url,
      note: `Live ${model.name}`,
    };
  } catch (err) {
    if (held) await failMediaCredits(held, err);
    const reason =
      err instanceof AdapterNotWiredError
        ? `Key present for ${model.provider}. Wire the fetch in src/lib/media/adapters.ts.`
        : err instanceof Error
          ? err.message
          : "Provider error";
    return stubGenerate(req, reason);
  }
}
