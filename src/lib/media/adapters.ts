import { referenceImage } from "./providers/frame";
import { googleAdapter } from "./providers/google";
import { openaiAdapter } from "./providers/openai";
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

/** Whether callProvider renders this request: an OpenAI or Google image model with a reference image. */
export function canRender(model: MediaModel, req: GenerateRequest) {
  return (
    model.kind === "image" &&
    (model.providerId === "openai" || model.providerId === "google") &&
    Boolean(referenceImage(req.contextImages))
  );
}

export async function callProvider(
  model: MediaModel,
  req: GenerateRequest,
  userKey?: string,
): Promise<{ url: string; costUsd: number }> {
  const apiKey = userKey || process.env[model.envKeys[0]];
  const reference = referenceImage(req.contextImages);
  if (!apiKey || !reference || !canRender(model, req)) {
    throw new AdapterNotWiredError(model.provider);
  }
  const adapter = model.providerId === "openai" ? openaiAdapter : googleAdapter;
  const rendered = await adapter.generate(req, {
    model,
    startImage: reference,
    apiKey: userKey,
  });
  return { url: `data:${rendered.mime};base64,${rendered.bytes.toString("base64")}`, costUsd: rendered.costUsd };
}
