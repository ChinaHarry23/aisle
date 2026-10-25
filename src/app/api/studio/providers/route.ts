import { getCurrentUser } from "@/lib/auth/current";
import { PROVIDERS } from "@/lib/media/catalog";
import { providerAvailability } from "@/lib/media/providers";

export const runtime = "nodejs";

/**
 * Which media providers this server can call. Says why not, never which key
 * or its value. Cindy's catalog has no ComfyUI id, so this reports cloud
 * adapters only.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  return Response.json(
    {
      providers: PROVIDERS.map((p) => ({ ...providerAvailability(p.id), name: p.name })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
