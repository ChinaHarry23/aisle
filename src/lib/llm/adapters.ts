import type { CompleteRequest, LlmModel } from "./types";

export class LlmAdapterNotWiredError extends Error {
  constructor(provider: string) {
    super(`${provider} LLM adapter is not wired yet. Add the fetch in src/lib/llm/adapters.ts`);
    this.name = "LlmAdapterNotWiredError";
  }
}

export function isLlmConfigured(model: LlmModel, localBaseUrl?: string) {
  if (model.providerId === "local") {
    return Boolean(localBaseUrl || process.env.LOCAL_LLM_BASE_URL);
  }
  return model.envKeys.every((key) => Boolean(process.env[key]));
}

export function systemFor(agent: CompleteRequest["agent"]) {
  const role = {
    trend:
      "You are the Trend Analyser for a neighbourhood retailer. Return JSON: trends, opportunities, personas, brief.",
    creative:
      "You are the Image Generation agent. Return JSON for two poster variants (A/B): headline, subhead, cta, caption, prompt.",
    compliance:
      "You are the Compliance Checker. Score copy against country advertising law and a banned-terms list. Return JSON findings.",
    media:
      "You are the Media Manager. Adapt one approved master into channel-specific copy and posting times. Return JSON.",
  };
  return role[agent];
}

export function buildLlmBody(model: LlmModel, req: CompleteRequest): Record<string, unknown> {
  const apiModel = model.id === "local:custom" ? req.localModel || "llama3.1" : model.apiModel;
  const messages = [
    { role: "system", content: systemFor(req.agent) },
    { role: "user", content: req.prompt },
  ];
  if (model.providerId === "anthropic") {
    return {
      model: apiModel,
      max_tokens: 1600,
      system: systemFor(req.agent),
      messages: [{ role: "user", content: req.prompt }],
    };
  }
  return {
    model: apiModel,
    temperature: 0.4,
    messages,
  };
}

function localBase(req: CompleteRequest) {
  return (req.localBaseUrl || process.env.LOCAL_LLM_BASE_URL || "http://127.0.0.1:11434/v1").replace(
    /\/$/,
    "",
  );
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

  const body = buildLlmBody(model, req);
  void body;
  throw new LlmAdapterNotWiredError(model.provider);
}
