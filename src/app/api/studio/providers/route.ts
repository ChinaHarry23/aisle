import { getCurrentUser } from "@/lib/auth/current";
import { PROVIDERS } from "@/lib/media/catalog";
import { comfyAvailability, providerAvailability } from "@/lib/media/providers";

export const runtime = "nodejs";

/**
 * Which media providers this server can call. Says why not, never which key
 * or its value. ComfyUI is probed (remembered ~30 s), so a hosted deployment
 * does not offer "free, local" renders that cannot run.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  return Response.json(
    { providers: await Promise.all(PROVIDERS.map(async (p) => ({ ...(p.id === "comfy" ? await comfyAvailability() : providerAvailability(p.id)), name: p.name }))) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
