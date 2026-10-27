/**
 * Puts the brand's real logo on a rendered image.
 *
 * Image models misspell and redraw logos, so the model is told to leave a corner
 * clear (see `LOGO_ZONE`)
 */
import sharp from "sharp";
import type { LogoAsset } from "./brand-inputs";
import { LOGO_ZONE } from "./prompts";

const MARGIN_PCT = 4;
const PLATE_PAD_PCT = 10;
const MAX_HEIGHT_PCT = 10;

export type LogoPlacement = { left: number; top: number; width: number; height: number };

export async function applyBrandLogo(
  image: { bytes: Uint8Array; mime: string },
  logo: LogoAsset,
  options: { plate?: string } = {},
): Promise<{ bytes: Buffer; mime: string; placement: LogoPlacement }> {
  const meta = await sharp(image.bytes).metadata();
  const width = meta.width;
  const height = meta.height;
  if (!width || !height) throw new Error("The rendered image has no readable size.");

  const target = Math.max(32, Math.round((width * LOGO_ZONE.widthPct) / 100));
  const resized = await sharp(logo.bytes, { density: 300 })
    .resize({ width: target, height: Math.max(16, Math.round((height * MAX_HEIGHT_PCT) / 100)), fit: "inside" })
    .png()
    .toBuffer({ resolveWithObject: true });

  const pad = Math.max(4, Math.round((resized.info.width * PLATE_PAD_PCT) / 100));
  const plateWidth = resized.info.width + pad * 2;
  const plateHeight = resized.info.height + pad * 2;
  const margin = Math.round((width * MARGIN_PCT) / 100);
  const plate = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${plateWidth}" height="${plateHeight}"><rect width="${plateWidth}" height="${plateHeight}" rx="${pad}" fill="${options.plate ?? "#ffffff"}"/></svg>`,
  );

  const composed = sharp(image.bytes).composite([
    { input: plate, left: margin, top: margin },
    { input: resized.data, left: margin + pad, top: margin + pad },
  ]);
  const mime = image.mime === "image/png" || image.mime === "image/webp" ? image.mime : "image/jpeg";
  const bytes =
    mime === "image/png" ? await composed.png().toBuffer()
    : mime === "image/webp" ? await composed.webp({ quality: 92 }).toBuffer()
    : await composed.jpeg({ quality: 92 }).toBuffer();
  return { bytes, mime, placement: { left: margin, top: margin, width: plateWidth, height: plateHeight } };
}
