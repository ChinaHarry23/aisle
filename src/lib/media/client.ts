import type { GenerateRequest, GenerateResult } from "./types";
import { stubGenerate } from "./stub";

export async function requestGenerate(req: GenerateRequest): Promise<GenerateResult> {
  if (typeof window === "undefined") {
    const { runGeneration } = await import("./generate");
    return runGeneration(req);
  }
  try {
    const res = await fetch("/api/studio/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()) as GenerateResult;
  } catch {
    return stubGenerate(req, "Studio stub — generate route unavailable.");
  }
}
