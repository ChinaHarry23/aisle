import coles from "@/data/retail/coles.json";
import woolworths from "@/data/retail/woolworths.json";

/** Local demo extracts. The same objects are what Brand loads and what the download route returns. */
export const bundledRetail = {
  coles,
  woolworths,
} as const;

export type BundledRetailId = keyof typeof bundledRetail;
