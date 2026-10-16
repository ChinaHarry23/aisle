/**
 * One store for generated media, whoever rendered it.
 *
 * Cloud providers hand back bytes (OpenAI base64, Google downloads), never a URL
 * the browser could load, so the bytes are kept here and the campaign stores
 * `aisle-media:<sha256>`. Every read goes through the asset route and is checked
 * against the owning account, so a guessed hash cannot open another user's take.
 *
 * Driver: files under AISLE_MEDIA_DIR on a local install; the `media_objects`
 * table when the database is Postgres (Vercel has no durable disk). The row is
 * written either way because it carries the owner. AISLE_MEDIA_DRIVER=fs|db
 * overrides the choice.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getDatabase, type Database } from "@/lib/db";
import { assertComfyAssetUrl, cachedComfyAsset } from "./assets";
import type { MediaKind } from "./pr2-types";

export type MediaMime = "image/png" | "image/jpeg" | "image/webp" | "video/mp4";

export const STORED_PREFIX = "aisle-media:";
/** Same caps as the ComfyUI cache. */
export const MEDIA_MAX_BYTES: Record<MediaKind, number> = { image: 25_000_000, video: 150_000_000 };

export class MediaNotFoundError extends Error {
  constructor() {
    super("Media not found.");
    this.name = "MediaNotFoundError";
  }
}

const EXT: Record<MediaMime, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4" };

/** The real type from magic bytes. A provider's declared type is never trusted alone. */
export function sniffMime(bytes: Uint8Array): MediaMime | null {
  const ascii = (from: number, to: number) => Buffer.from(bytes.subarray(from, to)).toString("latin1");
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp") return "video/mp4";
  return null;
}

export function mimeKind(mime: string): MediaKind | null {
  return mime === "video/mp4" ? "video" : ["image/png", "image/jpeg", "image/webp"].includes(mime) ? "image" : null;
}

export function isStoredMediaUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && url.startsWith(STORED_PREFIX);
}

/** Checks bytes are the kind and type claimed, within the size cap. Returns the sniffed type. */
export function assertMediaBytes(bytes: Uint8Array, kind: MediaKind, mime?: string): MediaMime {
  const sniffed = sniffMime(bytes);
  if (!sniffed || mimeKind(sniffed) !== kind) throw new Error(`Provider returned something that is not a valid ${kind}.`);
  if (mime && mime !== sniffed) throw new Error(`Provider said ${mime} but sent ${sniffed}.`);
  if (bytes.length > MEDIA_MAX_BYTES[kind]) throw new Error(`Generated ${kind} exceeds the storage size limit.`);
  return sniffed;
}

export function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function driverFor(db: Database): "fs" | "db" {
  const forced = process.env.AISLE_MEDIA_DRIVER?.trim().toLowerCase();
  if (forced === "fs" || forced === "db") return forced;
  return db.kind === "postgres" ? "db" : "fs";
}

function mediaRoot() {
  if (process.env.AISLE_MEDIA_DIR) return process.env.AISLE_MEDIA_DIR;
  // Vercel only allows writes under /tmp; the db driver is the durable option there.
  return process.env.VERCEL ? path.join(os.tmpdir(), "aisle-media") : path.resolve("data/generated-media");
}

/** One row per owner and content, so the same bytes from two accounts stay separately owned. */
const rowId = (sha256: string, ownerId: string) => `${sha256}:${ownerId}`;

export async function putMedia(input: { ownerId: string; kind: MediaKind; bytes: Uint8Array; mime: string }): Promise<{ url: string; sha256: string }> {
  if (!input.ownerId) throw new Error("Stored media needs an owning account.");
  const mime = assertMediaBytes(input.bytes, input.kind, input.mime);
  const sha256 = sha256Hex(input.bytes);
  const db = await getDatabase();
  const driver = driverFor(db);
  if (driver === "fs") {
    const root = mediaRoot();
    // Runtime media folder, not a source path: keep Turbopack from tracing the project.
    const file = path.join(/*turbopackIgnore: true*/ root, `${sha256}.${EXT[mime]}`);
    const exists = await stat(file).then(() => true, () => false);
    if (!exists) {
      await mkdir(root, { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, input.bytes);
      await rename(temporary, file);
    }
  }
  await db.execute(
    `insert into media_objects (id, owner_user_id, kind, mime, size, driver, bytes, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (id) do nothing`,
    [rowId(sha256, input.ownerId), input.ownerId, input.kind, mime, input.bytes.length, driver, driver === "db" ? Buffer.from(input.bytes) : null, new Date().toISOString()],
  );
  return { url: `${STORED_PREFIX}${sha256}`, sha256 };
}

/**
 * Bytes for a saved generation URL. `aisle-media:` rows must belong to
 * `ownerId`; ComfyUI `/view` URLs must be Aisle outputs (type=output in the
 * `aisle/` subfolder) and go through the local cache as before.
 */
export async function readMedia(url: string, kind: MediaKind, ownerId: string): Promise<{ bytes: Buffer; mime: MediaMime; sha256: string }> {
  if (!isStoredMediaUrl(url)) {
    // Only Aisle's own ComfyUI outputs; anything else on that box is "not found".
    try { assertComfyAssetUrl(url); } catch { throw new MediaNotFoundError(); }
    const cached = await cachedComfyAsset(url, kind);
    return { bytes: cached.bytes, mime: cached.mime as MediaMime, sha256: sha256Hex(cached.bytes) };
  }
  const sha256 = url.slice(STORED_PREFIX.length);
  if (!/^[a-f0-9]{64}$/.test(sha256) || !ownerId) throw new MediaNotFoundError();
  const db = await getDatabase();
  const rows = await db.query<{ kind: string; mime: string; driver: string; bytes: Uint8Array | null }>(
    "select kind, mime, driver, bytes from media_objects where id = $1 and owner_user_id = $2",
    [rowId(sha256, ownerId), ownerId],
  );
  const row = rows[0];
  if (!row || row.kind !== kind) throw new MediaNotFoundError();
  const mime = row.mime as MediaMime;
  const bytes = row.driver === "db" && row.bytes
    ? Buffer.from(row.bytes)
    : await readFile(path.join(/*turbopackIgnore: true*/ mediaRoot(), `${sha256}.${EXT[mime] ?? "bin"}`)).catch(() => { throw new MediaNotFoundError(); });
  // Content addressing doubles as an integrity check on whatever the driver returned.
  if (sha256Hex(bytes) !== sha256) throw new Error("Stored media failed its integrity check.");
  return { bytes, mime, sha256 };
}
