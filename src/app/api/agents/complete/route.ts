import { LLM_MODELS } from "@/lib/llm/catalog";
import { runComplete } from "@/lib/llm/complete";
import type { CompleteRequest } from "@/lib/llm/types";

export async function POST(req: Request) {
  const body = (await req.json()) as CompleteRequest;
  if (!body?.modelId || !body.agent || !body.prompt) {
    return Response.json({ error: "modelId, agent, and prompt are required" }, { status: 400 });
  }
  if (!LLM_MODELS.some((m) => m.id === body.modelId)) {
    return Response.json({ error: "Unknown LLM" }, { status: 400 });
  }
  const result = await runComplete(body);
  return Response.json(result);
}
