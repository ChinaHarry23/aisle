import { getCurrentUser } from "@/lib/auth/current";
import { billingForSession, type BillingContext } from "@/lib/billing/meter";
import { AGENT_SLOTS, findLlm } from "@/lib/llm/catalog";
import { runComplete } from "@/lib/llm/complete";
import type { CompleteRequest } from "@/lib/llm/types";

/** Real agent prompts are a few KB; anything far beyond that is not a decision. */
const MAX_PROMPT_CHARS = 20_000;

/**
 * One agent decision on the signed-in user's credits. Never an open proxy to
 * the platform keys, and never to a URL of the caller's choosing: the request
 * is rebuilt from known fields, so a client `localBaseUrl` is dropped and a
 * Local seat calls only the server's own local runtime.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body?.modelId || !body.agent || !body.prompt) {
    return Response.json({ error: "modelId, agent, and prompt are required" }, { status: 400 });
  }
  const { modelId, agent, prompt, localModel } = body;
  if (typeof agent !== "string" || !AGENT_SLOTS.some((slot) => slot.id === agent) || typeof prompt !== "string") {
    return Response.json({ error: "Unknown agent" }, { status: 400 });
  }
  if (typeof modelId !== "string" || !findLlm(modelId)) {
    return Response.json({ error: "Unknown LLM" }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return Response.json({ error: `prompt is longer than ${MAX_PROMPT_CHARS.toLocaleString("en-US")} characters` }, { status: 413 });
  }
  const safe: CompleteRequest = {
    agent: agent as CompleteRequest["agent"],
    modelId,
    prompt,
    ...(typeof localModel === "string" && localModel.trim() ? { localModel: localModel.trim().slice(0, 200) } : {}),
  };

  // The role comes from the database, not the 30-day cookie. If that lookup
  // fails, nobody pays: cloud seats are refused and Local still runs.
  let billing: BillingContext | undefined;
  try {
    billing = await billingForSession(user);
    if (!billing) return Response.json({ error: "Sign in again." }, { status: 401 });
  } catch (error) {
    console.error("[credits] account lookup failed", error);
  }
  return Response.json(await runComplete(safe, billing));
}
