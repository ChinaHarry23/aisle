import { LLM_MODELS } from "@/lib/llm/catalog";
import { MEDIA_MODELS } from "@/lib/media/catalog";

/** A provider counts as connected when any of its models has every env key set. Only booleans leave the server. */
function connected(models: { providerId: string; envKeys: string[] }[]) {
  const out: Record<string, boolean> = {};
  for (const m of models) {
    const ok = m.envKeys.every((key) => Boolean(process.env[key]));
    out[m.providerId] = out[m.providerId] || ok;
  }
  return out;
}

export async function GET() {
  return Response.json({ llm: connected(LLM_MODELS), media: connected(MEDIA_MODELS) });
}
