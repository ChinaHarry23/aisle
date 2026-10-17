import type { GenerateRequest, GenerateResult } from "./types";
import { getByoKey } from "./byo-key";
import { getModel } from "./catalog";
import { stubGenerate } from "./stub";

export async function requestGenerate(req: GenerateRequest): Promise<GenerateResult> {
  const fallback = () => stubGenerate(req, "Studio stub — generate route unavailable.");
  let providerId: string;
  try {
    providerId = getModel(req.modelId).providerId;
  } catch {
    // A saved id such as comfy:local is no longer in the catalogue. Stubbing
    // here keeps the creative step from failing the whole operation.
    return fallback();
  }
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const key = getByoKey(providerId);
    if (key) headers["x-provider-key"] = key;
    const res = await fetch("/api/studio/generate", {
      method: "POST",
      headers,
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()) as GenerateResult;
  } catch {
    return fallback();
  }
}
