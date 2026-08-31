import { stubComplete } from "./stub";
import type { CompleteRequest, CompleteResult } from "./types";

export async function requestComplete(req: CompleteRequest): Promise<CompleteResult> {
  try {
    const res = await fetch("/api/agents/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()) as CompleteResult;
  } catch {
    return stubComplete(req, "Agent complete route unavailable.");
  }
}
