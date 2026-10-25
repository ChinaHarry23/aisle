import { DEFAULT_LOCAL_BASE_URL } from "../settings";
import { isHosted } from "@/lib/billing/hosted";
import { allowedLocalBase, refusedLocalBaseMessage } from "./local-base";
import type { CompleteRequest, LlmModel } from "./types";

class LlmAdapterNotWiredError extends Error {
  constructor(provider: string) {
    super(`${provider} LLM adapter is not wired yet. Add the fetch in src/lib/llm/adapters.ts`);
    this.name = "LlmAdapterNotWiredError";
  }
}

export function isLlmConfigured(model: LlmModel, localBaseUrl?: string) {
  if (model.providerId === "local") {
    return Boolean(localBaseUrl?.trim() || process.env.LOCAL_LLM_BASE_URL?.trim());
  }
  return model.envKeys.every((key) => Boolean(process.env[key]));
}

export function systemFor(agent: CompleteRequest["agent"]) {
  const role = {
    trend:
      "You are the Trend Analyser for a neighbourhood retailer. Return one JSON object with priorities, angle, keyMessage, claimsAllowed, claimsAvoid, visualDirection, and limitations. The keyMessage is the poster headline for this product only.",
    creative:
      "You are the Image Generation agent. Return JSON for two ad variants (A/B): headline, subhead, cta, caption, prompt.",
    compliance:
      "You are the Compliance Checker. Read the poster and the uploaded advertising-law documents. Flag words that may raise a legal issue. Return JSON findings.",
    media:
      "You are the Media Manager. Adapt one approved master into channel-specific copy and posting times. Return JSON.",
  };
  return role[agent];
}

export function buildLlmBody(model: LlmModel, req: CompleteRequest): Record<string, unknown> {
  const apiModel = model.id === "local:custom" ? req.localModel || "llama3.1" : model.apiModel;
  const userContent = req.images?.length
    ? [{ type: "text", text: req.prompt }, ...req.images.map((url) => ({ type: "image_url", image_url: { url } }))]
    : req.prompt;
  const messages = [
    { role: "system", content: req.system || systemFor(req.agent) },
    { role: "user", content: userContent },
  ];
  if (model.providerId === "anthropic") {
    return {
      model: apiModel,
      max_tokens: 1600,
      system: systemFor(req.agent),
      messages: [{ role: "user", content: req.prompt }],
    };
  }
  if (model.reasoning) {
    return {
      model: apiModel,
      messages,
      reasoning_effort: model.effort ?? "low",
    };
  }
  return {
    model: apiModel,
    temperature: 0.4,
    messages,
  };
}

/**
 * The local server a call goes to. An account's own URL must pass
 * allowedLocalBase; a refused one throws instead of falling back, so the
 * founder sees why their setting did not take.
 */
export function localBase(req: CompleteRequest) {
  if (req.localBaseUrl?.trim()) {
    const allowed = allowedLocalBase(req.localBaseUrl);
    if (!allowed) throw new Error(refusedLocalBaseMessage());
    return allowed;
  }
  const configured = process.env.LOCAL_LLM_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  // The laptop default is never assumed on a hosted server.
  if (isHosted()) throw new Error(refusedLocalBaseMessage());
  return DEFAULT_LOCAL_BASE_URL.replace(/\/$/, "");
}

export async function callLlm(
  model: LlmModel,
  req: CompleteRequest,
): Promise<{ text: string; inputTokens?: number; outputTokens?: number }> {
  if (model.providerId === "local") {
    const res = await fetch(`${localBase(req)}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildLlmBody(model, req)),
      // A redirect could carry the request past the URL check above.
      redirect: "error",
      signal: AbortSignal.timeout(2_500),
    });
    if (!res.ok) {
      throw new Error(`Local LLM ${res.status}: ${(await res.text()).slice(0, 240)}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    return {
      text,
      inputTokens: json.usage?.prompt_tokens,
      outputTokens: json.usage?.completion_tokens,
    };
  }

  throw new LlmAdapterNotWiredError(model.provider);
}
