import type { GenerateRequest, MediaModel } from "./types";

export class AdapterNotWiredError extends Error {
  constructor(provider: string) {
    super(`${provider} adapter is not wired yet. Add the fetch in src/lib/media/adapters.ts`);
    this.name = "AdapterNotWiredError";
  }
}

export function isProviderConfigured(envKeys: string[]) {
  return envKeys.every((key) => Boolean(process.env[key]));
}

/**
 * Each provider maps a unified GenerateRequest into the payload you will POST
 * once the key is in .env. Uncomment the fetch and return { url, usage }.
 */
export function buildProviderBody(model: MediaModel, req: GenerateRequest): Record<string, unknown> {
  switch (model.providerId) {
    case "openai":
      if (model.kind === "video") {
        return {
          model: model.apiModel,
          prompt: req.prompt,
          seconds: String(req.durationSec ?? 8),
          size: req.aspectRatio === "9:16" ? "720x1280" : "1280x720",
        };
      }
      return {
        model: model.apiModel,
        prompt: req.prompt,
        n: 1,
        size: req.aspectRatio === "9:16" ? "1024x1536" : "1024x1024",
        quality: req.quality ?? "medium",
        output_format: req.format === "jpg" ? "jpeg" : "png",
        ...(req.contextImages?.length ? { input_fidelity: req.inputFidelity ?? "high" } : {}),
      };
    case "google":
      return {
        prompt: req.prompt,
        aspectRatio: req.aspectRatio ?? "4:5",
        durationSeconds: req.durationSec,
      };
    case "bfl":
      return { prompt: req.prompt, aspect_ratio: req.aspectRatio ?? "4:5" };
    case "ideogram":
      return {
        prompt: req.prompt,
        aspect_ratio: req.aspectRatio ?? "4:5",
        rendering_speed: model.id.includes("turbo") ? "TURBO" : "QUALITY",
      };
    case "runway":
      return {
        model: model.apiModel,
        promptText: req.prompt,
        duration: req.durationSec ?? 8,
        ratio: req.aspectRatio ?? "16:9",
      };
    default:
      return { model: model.apiModel, prompt: req.prompt, duration: req.durationSec };
  }
}

export async function callProvider(
  model: MediaModel,
  req: GenerateRequest,
  userKey?: string,
): Promise<{ url: string; raw?: unknown }> {
  const apiKey = userKey || process.env[model.envKeys[0]];
  if (!apiKey) {
    throw new AdapterNotWiredError(model.provider);
  }
  // No provider is wired to a live endpoint yet; build the body so the mapping stays exercised.
  void buildProviderBody(model, req);
  throw new AdapterNotWiredError(model.provider);
}
