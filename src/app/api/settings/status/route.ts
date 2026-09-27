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

const whatsapp = {
  live: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
  displayNumber: process.env.WHATSAPP_DISPLAY_NUMBER || null,
};

export async function GET() {
  return Response.json({ llm, media, whatsapp });
}
