import { getCurrentUser } from "@/lib/auth/current";
import { billingForSession } from "@/lib/billing/meter";
import { runGeneration } from "@/lib/media/generate";
import { modelsOf } from "@/lib/media/catalog";
import type { GenerateRequest } from "@/lib/media/types";

export const runtime = "nodejs";

const QUALITIES: readonly string[] = ["low", "medium", "high"];
const ASPECTS: readonly string[] = ["1:1", "4:5", "3:4", "16:9", "9:16"];

/**
 * Studio's free-form render. The proxy only checks that the cookie is signed;
 * this reads the account from the database and bills it, so a deleted or
 * demoted account cannot render on the owner's key.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as GenerateRequest | null;
  if (typeof body?.modelId !== "string" || typeof body.kind !== "string" || typeof body.prompt !== "string" || !body.prompt.trim()) {
    return Response.json({ error: "modelId, kind, and prompt are required" }, { status: 400 });
  }
  // These reach the provider and the credit quote, so only known values pass.
  if (body.quality !== undefined && !QUALITIES.includes(body.quality)) {
    return Response.json({ error: "quality must be low, medium or high" }, { status: 400 });
  }
  if (body.aspectRatio !== undefined && !ASPECTS.includes(body.aspectRatio)) {
    return Response.json({ error: "Unknown aspect ratio" }, { status: 400 });
  }
  if (body.contextImages !== undefined && (!Array.isArray(body.contextImages) || body.contextImages.some((item) => typeof item !== "string"))) {
    return Response.json({ error: "contextImages must be a list of image URLs" }, { status: 400 });
  }
  if (!modelsOf(body.kind).some((m) => m.id === body.modelId)) {
    return Response.json({ error: "Unknown model for this kind" }, { status: 400 });
  }
  const userKey = req.headers.get("x-provider-key")?.trim() || undefined;
  const result = await runGeneration(body, userKey, await billingForSession(user));
  return Response.json(result);
}
