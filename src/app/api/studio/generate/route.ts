import { runGeneration } from "@/lib/media/generate";
import { MEDIA_MODELS } from "@/lib/media/catalog";
import type { GenerateRequest } from "@/lib/media/types";

export async function POST(req: Request) {
  const body = (await req.json()) as GenerateRequest;
  if (!body?.modelId || !body.kind || !body.prompt) {
    return Response.json({ error: "modelId, kind, and prompt are required" }, { status: 400 });
  }
  if (!MEDIA_MODELS.some((m) => m.id === body.modelId && m.kind === body.kind)) {
    return Response.json({ error: "Unknown model for this kind" }, { status: 400 });
  }
  const result = await runGeneration(body);
  return Response.json(result);
}
