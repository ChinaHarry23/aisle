const llm = {
  openai: Boolean(process.env.OPENAI_API_KEY),
  anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
  cursor: Boolean(process.env.CURSOR_API_KEY),
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

export async function GET() {
  return Response.json({ llm, media });
}
