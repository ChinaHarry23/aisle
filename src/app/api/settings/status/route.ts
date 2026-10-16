import { loadedLocalModel } from "@/lib/llm/adapters";
import { comfyReachable } from "@/lib/media/comfy";
import { DEFAULT_LOCAL_BASE_URL } from "@/lib/settings";

/** Whether the platform key for each cloud LLM is set, i.e. whether credits can buy it here. */
const llm = {
  openai: Boolean(process.env.OPENAI_API_KEY),
  anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
  local: Boolean(process.env.LOCAL_LLM_BASE_URL),
};

const media = {
  openai: Boolean(process.env.OPENAI_API_KEY),
  google: Boolean(process.env.GOOGLE_AI_API_KEY),
  bfl: Boolean(process.env.BFL_API_KEY),
  ideogram: Boolean(process.env.IDEOGRAM_API_KEY),
  recraft: Boolean(process.env.RECRAFT_API_KEY),
  xai: Boolean(process.env.XAI_API_KEY),
  luma: Boolean(process.env.LUMA_API_KEY),
  runway: Boolean(process.env.RUNWAYML_API_SECRET),
};

/**
 * What the server-side local runtime can answer with right now. Only the
 * configured URL is probed — never one supplied by the browser — so the page
 * is told which URL that was and can say when its seats call another.
 */
async function localRuntime() {
  const localBase = (process.env.LOCAL_LLM_BASE_URL || DEFAULT_LOCAL_BASE_URL).replace(/\/$/, "");
  const [localModel, comfy] = await Promise.all([loadedLocalModel(localBase), comfyReachable()]);
  return { localBase, localModel, comfy };
}

export async function GET() {
  return Response.json({ llm, media, runtime: await localRuntime() });
}
