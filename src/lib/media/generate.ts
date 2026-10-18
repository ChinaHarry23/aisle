import { AdapterNotWiredError, callProvider, isProviderConfigured } from "./adapters";
import { getModel } from "./catalog";
import { stubGenerate } from "./stub";
import type { GenerateRequest, GenerateResult } from "./types";

export async function runGeneration(
  req: GenerateRequest,
  userKey?: string,
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

  try {
    const live = await callProvider(model, req, userKey);
    const stub = stubGenerate(req, "Live URL attached.");
    return {
      ...stub,
      status: "ok",
      url: live.url,
      note: `Live ${model.name}`,
    };
  } catch (err) {
    const reason =
      err instanceof AdapterNotWiredError
        ? `Key present for ${model.provider}. Wire the fetch in src/lib/media/adapters.ts.`
        : err instanceof Error
          ? err.message
          : "Provider error";
    return stubGenerate(req, reason);
  }
}
