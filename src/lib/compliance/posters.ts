import { readMedia } from "@/lib/media/store";
import type { Campaign } from "@/lib/types";

const MAX_BYTES = 1_200_000;

/** Poster pictures a vision model can read. Stored files are sent as image data. */
export async function posterImages(campaign: Campaign, ownerId?: string): Promise<string[]> {
  const images: string[] = [];
  for (const creative of campaign.creatives.slice(0, 2)) {
    const url = creative.generation?.url;
    if (!url) continue;
    if (url.startsWith("data:image/")) {
      if (url.length < MAX_BYTES * 1.4) images.push(url);
      continue;
    }
    if (url.startsWith("https://") || url.startsWith("http://")) {
      images.push(url);
      continue;
    }
    if (ownerId && url.startsWith("aisle-media:")) {
      try {
        const media = await readMedia(url, "image", ownerId);
        if (media.bytes.length <= MAX_BYTES) images.push(`data:${media.mime};base64,${media.bytes.toString("base64")}`);
      } catch {
        // The review still has the written copy. The prompt says the picture was not attached.
      }
    }
  }
  return images;
}
