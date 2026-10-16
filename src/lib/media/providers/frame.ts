/**
 * Start-frame helpers for image-to-video adapters whose clip keeps the
 * poster's framing (Seedance "adaptive", Hunyuan Video, Kling, Wan). The
 * aspect a clip really has is read from the poster's own header, not assumed.
 */
import type { AspectRatio } from "../types";

const RATIOS: [AspectRatio, number][] = [["1:1", 1], ["4:5", 4 / 5], ["3:4", 3 / 4], ["16:9", 16 / 9], ["9:16", 9 / 16]];

/** Pixel size from a PNG, JPEG or WebP header, or undefined when it cannot be read. */
export function imageSize(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes.toString("latin1", 12, 16) === "IHDR") {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) { at++; continue; }
      const marker = bytes[at + 1];
      if (marker === 0xff) { at++; continue; }
      // SOF0–SOF15 carry the frame size; C4 (DHT), C8 (JPG) and CC (DAC) do not.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
      at += 2 + bytes.readUInt16BE(at + 2);
    }
    return undefined;
  }
  if (bytes.length >= 30 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") {
    const chunk = bytes.toString("latin1", 12, 16);
    if (chunk === "VP8X") return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
    if (chunk === "VP8 ") return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = bytes.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  return undefined;
}

/** The Aisle aspect closest to a width/height pair (compared on a log scale). */
export function nearestAspect(width: number, height: number): AspectRatio | undefined {
  if (!(width > 0 && height > 0)) return undefined;
  const target = Math.log(width / height);
  return RATIOS.reduce((best, [id, r]) => Math.abs(Math.log(r) - target) < Math.abs(Math.log(best[1]) - target) ? [id, r] : best, RATIOS[0])[0];
}

/** The aspect a clip that follows its start frame will have. */
export function frameAspect(bytes: Buffer): AspectRatio | undefined {
  const size = imageSize(bytes);
  return size ? nearestAspect(size.width, size.height) : undefined;
}

/** A provider's "W:H" ratio label as an Aisle aspect, when it is one. */
export function ratioAspect(ratio: string | undefined): AspectRatio | undefined {
  return RATIOS.find(([id]) => id === ratio)?.[0];
}

/** Moderation refusals are never retried and never billed; say so plainly. */
export function moderationMessage(provider: string, what: string) {
  return `${provider} declined this ${what} under its content policy. Nothing was charged; edit the brief or pick another poster before trying again.`;
}
