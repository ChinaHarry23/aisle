/** Server-only local media cache. URLs are never accepted from an asset GET request. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MediaKind } from "./pr2-types";

/** Largest generated image/video Aisle keeps: the ComfyUI cache and the media store share these caps. */
export const MEDIA_MAX_BYTES: Record<MediaKind, number> = { image: 25_000_000, video: 150_000_000 };

/**
 * A ComfyUI `/view` link Aisle itself rendered: an output (never an upload,
 * which may be another account's start frame) in Aisle's own `aisle/`
 * subfolder, with a plain file name. A saved campaign is user-editable, so
 * any other file on the ComfyUI box is refused.
 */
export function assertComfyAssetUrl(value: string) {
  const url = new URL(value);
  const base = new URL(process.env.COMFYUI_URL || "http://127.0.0.1:8188");
  const refuse = () => { throw new Error("Only an existing ComfyUI output may be used as local media."); };
  if (url.origin !== base.origin || url.pathname !== "/view" || url.username || url.password) refuse();
  const filename = url.searchParams.get("filename") ?? "";
  const subfolder = url.searchParams.get("subfolder") ?? "";
  if (url.searchParams.get("type") !== "output") refuse();
  if (!filename || /[\\/]|^\.\.?$/.test(filename)) refuse();
  if (!/^aisle(\/[\w.-]+)*$/.test(subfolder) || subfolder.split("/").some((part) => part === ".." || part === ".")) refuse();
  return url;
}

export async function cachedComfyAsset(url: string, kind: MediaKind) {
  assertComfyAssetUrl(url);
  const root = process.env.AISLE_MEDIA_DIR || path.resolve("data/generated-media");
  const key = createHash("sha256").update(`${kind}:${url}`).digest("hex");
  // Runtime media folder, not a source path: keep Turbopack from tracing the project.
  const file = path.join(/*turbopackIgnore: true*/ root, `${key}.${kind === "image" ? "png" : "mp4"}`);
  try { return { bytes: await readFile(file), file, mime: kind === "image" ? "image/png" : "video/mp4" }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(120000) });
  const mime = (response.headers.get("content-type") || "").split(";")[0];
  if (!response.ok || !response.body || mime !== (kind === "image" ? "image/png" : "video/mp4")) {
    throw new Error(`Generated ${kind} is unavailable or has an unsupported format.`);
  }
  const max = MEDIA_MAX_BYTES[kind];
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); throw new Error("Generated media exceeds the cache size limit."); }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length < 8) throw new Error("Generated media is empty.");
  await mkdir(root, { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, file);
  return { bytes, file, mime };
}

/**
 * Largest body one response carries. Vercel Functions cap a response at 4.5 MB,
 * so a long video is served as a series of ranges the browser already asks for.
 */
export const MAX_RANGE_BYTES = 4_000_000;

/** Range support is required for seeking and reliable browser video playback. */
export function mediaResponse(bytes: Uint8Array, mime: string, range: string | null) {
  const headers = new Headers({ "Content-Type": mime, "Cache-Control": "private, no-store", "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff" });
  if (!range) {
    // <video> always sends Range; a plain GET of a large clip gets the first chunk.
    if (mime.startsWith("video/") && bytes.length > MAX_RANGE_BYTES) range = "bytes=0-";
    else { headers.set("Content-Length", String(bytes.length)); return new Response(bytes as BodyInit, { headers }); }
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  let start = Number(match?.[1] || 0), end = Number(match?.[2] || bytes.length - 1);
  if (match && !match[1] && match[2]) { start = Math.max(0, bytes.length - Number(match[2])); end = bytes.length - 1; }
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes.length) {
    headers.set("Content-Range", `bytes */${bytes.length}`);
    return new Response(null, { status: 416, headers });
  }
  end = Math.min(end, bytes.length - 1, start + MAX_RANGE_BYTES - 1);
  headers.set("Content-Range", `bytes ${start}-${end}/${bytes.length}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(bytes.slice(start, end + 1) as BodyInit, { status: 206, headers });
}
