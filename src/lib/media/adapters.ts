import { createHash } from "node:crypto";
import { googleAdapter } from "./providers/google";
import { openaiAdapter } from "./providers/openai";
import type { MediaModel as ProviderModel } from "./pr2-types";
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

function referenceImage(req: GenerateRequest) {
  const raw = req.contextImages?.find((item) => item.startsWith("data:image/"));
  if (!raw) return undefined;
  const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(raw);
  if (!match) return undefined;
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (bytes.length < 32 || bytes.length > 4_000_000) return undefined;
  return {
    bytes,
    mime: match[1] === "image/jpg" ? "image/jpeg" : match[1],
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
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
  const reference = referenceImage(req);
  if (reference && model.kind === "image" && (model.providerId === "openai" || model.providerId === "google")) {
    const adapter = model.providerId === "openai" ? openaiAdapter : googleAdapter;
    const rendered = await adapter.generate(req, {
      model: model as unknown as ProviderModel,
      startImage: reference,
      apiKey: userKey,
    });
    return { url: `data:${rendered.mime};base64,${rendered.bytes.toString("base64")}` };
  }
  // The remaining providers still only have a request mapping.
  void buildProviderBody(model, req);
  throw new AdapterNotWiredError(model.provider);
}
