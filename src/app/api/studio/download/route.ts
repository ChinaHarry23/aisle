import { getCurrentUser } from "@/lib/auth/current";
import { mediaResponse } from "@/lib/media/assets";
import { MediaNotFoundError, readMedia, STORED_PREFIX } from "@/lib/media/store";

export const runtime = "nodejs";

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4" };

/**
 * A stored cloud take by its hash, for the account that owns it. Used when a
 * paid render could not be attached to its campaign (it was approved or its
 * poster changed meanwhile), so the take is not lost.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const sha256 = params.get("media") ?? "";
  const kind = params.get("kind");
  if (!/^[a-f0-9]{64}$/.test(sha256) || (kind !== "image" && kind !== "video")) return Response.json({ error: "Media not found." }, { status: 404 });
  try {
    const { bytes, mime } = await readMedia(`${STORED_PREFIX}${sha256}`, kind, user.id);
    const response = mediaResponse(bytes, mime, request.headers.get("range"));
    response.headers.set("Content-Disposition", `attachment; filename="aisle-${kind}-${sha256.slice(0, 12)}.${EXT[mime] ?? "bin"}"`);
    return response;
  } catch (error) {
    if (error instanceof MediaNotFoundError) return Response.json({ error: "Media not found." }, { status: 404 });
    return Response.json({ error: "Media is temporarily unavailable." }, { status: 503 });
  }
}
