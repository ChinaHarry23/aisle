/**
 * Pure shelf-price shaping for WhichGrocer.
 *
 * The WhichGrocer API returns catalogue JSON. These helpers turn that payload
 * into one comparable offer per grocery retailer, without calling the network,
 * so the brief text can be tested on its own.
 */

export type ShelfOffer = {
  id: string;
  name: string;
  store: string;
  storeLabel: string;
  price: number;
  currency: string;
  cupPrice: string | null;
  url: string | null;
  special: boolean;
  discountPct: number | null;
  outOfStock: boolean;
  observedAt: string | null;
  archived?: boolean;
  stale?: boolean;
  unitPrice?: number | null;
  unitMeasure?: string | null;
  priceStats?: { average30d: number | null; lowest30d: number | null; highest30d: number | null };
};

const STORE_LABELS: Record<string, string> = {
  coles: "Coles",
  woolworths: "Woolworths",
  aldi: "ALDI",
  iga: "IGA",
  chemist_warehouse: "Chemist Warehouse",
  priceline: "Priceline",
  big_w: "BIG W",
  kmart: "Kmart",
  bunnings: "Bunnings",
};

/** Supermarket chains. A juice brief should not be priced at Bunnings. */
export const GROCERY_STORES = new Set(["coles", "woolworths", "aldi", "iga"]);

function storeLabel(store: string): string {
  const key = store.trim().toLowerCase();
  return STORE_LABELS[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** "I want to sell apple juice" is a brief, not a catalogue query. */
export function shelfQuery(product: string, category = ""): string {
  const head = (product.split(/[([+—,]/)[0] ?? "").trim();
  const stripped = head
    .replace(/^\s*i\s+want\s+to\s+(sell|promote|advertise|feature)\s+/i, "")
    .replace(/^\s*(sell|promote|advertise|feature)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return (stripped || category).replace(/\s+/g, " ").trim().slice(0, 80);
}

function asPrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asDay(value: unknown): string | null {
  const text = asText(value);
  return text && /^\d{4}-\d{2}-\d{2}/.test(text) && Number.isFinite(Date.parse(text)) ? text.slice(0, 10) : null;
}

function offerFromRecord(record: Record<string, unknown>): ShelfOffer | null {
  const price = asPrice(record.price);
  const name = asText(record.name);
  const store = asText(record.store)?.toLowerCase() ?? "";
  if (!price || !name || !store) return null;
  const stats =
    record.price_stats && typeof record.price_stats === "object"
      ? (record.price_stats as Record<string, unknown>)
      : null;
  return {
    archived: Boolean(record.last_seen_at),
    stale: record.is_stale === true,
    unitPrice: typeof record.unit_price === 'number' ? record.unit_price : null,
    unitMeasure: asText(record.unit_measure),
    priceStats: stats ? {average30d: typeof stats.average_30d==='number'?stats.average_30d:null,lowest30d:typeof stats.lowest_30d==='number'?stats.lowest_30d:null,highest30d:typeof stats.highest_30d==='number'?stats.highest_30d:null}:undefined,
    id: asText(record.id) ?? `${store}:${name}`,
    name,
    store,
    storeLabel: storeLabel(store),
    price,
    currency: asText(record.currency) ?? "AUD",
    cupPrice: asText(record.cup_price) ?? asText(record.cupPrice),
    url: asText(record.url),
    special: record.is_special === true || stats?.is_below_average === true,
    discountPct: typeof stats?.discount_pct === "number" ? stats.discount_pct : null,
    outOfStock: record.out_of_stock === true,
    observedAt: asDay(record.last_seen_at) ?? asDay(record.updated_at),
  };
}

/** Pull product rows out of a WhichGrocer JSON body or an MCP tool result. */
export function offersFromPayload(payload: unknown): ShelfOffer[] {
  const found: ShelfOffer[] = [];
  const seen = new Set<string>();
  const walk = (value: unknown, depth: number) => {
    if (depth > 6 || value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const offer = offerFromRecord(record);
    if (offer && !seen.has(offer.id)) {
      seen.add(offer.id);
      found.push(offer);
    }
    for (const key of ["data", "products", "members", "results", "items"]) {
      if (key in record) walk(record[key], depth + 1);
    }
  };
  walk(unwrapToolResult(payload), 0);
  return found;
}

/** MCP tools return `{ content: [{ type: "text", text }] }`. Parse that text when it is JSON. */
function unwrapToolResult(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const record = result as Record<string, unknown>;
  if (!Array.isArray(record.content)) return result;
  const text = record.content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      return typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "";
    })
    .join("\n")
    .trim();
  if (!text) return result;
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { text };
    }
  }
  return { text };
}

function nameScore(name: string, query: string): number {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 1);
  const haystack = name.toLowerCase();
  return words.reduce((score, word) => score + (haystack.includes(word) ? 1 : 0), 0);
}

/** One in-stock offer per retailer, preferring names that contain the query. */
export function comparisonOffers(offers: ShelfOffer[], query: string): ShelfOffer[] {
  const scored = offers.map((offer) => ({ offer, score: nameScore(offer.name, query) }));
  const matched = scored.filter((item) => item.score > 0);
  const pool = matched.length > 0 ? matched : scored;
  const grocery = pool.filter((item) => GROCERY_STORES.has(item.offer.store));
  const use = grocery.length > 0 ? grocery : pool;
  const best = new Map<string, { offer: ShelfOffer; score: number }>();
  for (const item of use) {
    const previous = best.get(item.offer.store);
    const closer =
      !previous ||
      item.score > previous.score ||
      (item.score === previous.score && !item.offer.outOfStock && previous.offer.outOfStock) ||
      (item.score === previous.score &&
        item.offer.outOfStock === previous.offer.outOfStock &&
        item.offer.name.length < previous.offer.name.length);
    if (closer) best.set(item.offer.store, item);
  }
  return [...best.values()].map((item) => item.offer).sort((a, b) => a.price - b.price);
}

export function aud(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function describeShelf(query: string, offers: ShelfOffer[], at: string): {
  claim: string;
  detail: string;
  sourceRef: string;
  observedAt: string | null;
} {
  const priced = [...offers].sort((a, b) => a.price - b.price);
  const claim = `${query}: ${priced.map((offer) => `${offer.storeLabel} ${aud(offer.price)}`).join(", ")}`;
  const lines = priced.map((offer) => {
    const stock = offer.outOfStock ? ", out of stock" : "";
    const cup = offer.cupPrice ? `, ${offer.cupPrice}` : "";
    const special =
      offer.special && offer.discountPct != null
        ? `, ${Math.round(offer.discountPct)}% below the 30-day average (not a verified promotion)`
        : offer.special
          ? ", provider special flag; promotion dates unknown"
          : "";
    const stats=offer.priceStats?`, 30-day average/low/high ${offer.priceStats.average30d ?? 'unknown'}/${offer.priceStats.lowest30d ?? 'unknown'}/${offer.priceStats.highest30d ?? 'unknown'}`:'';
    const unit=offer.unitPrice!=null&&offer.unitMeasure?`, ${offer.unitPrice} AUD per ${offer.unitMeasure}`:'';
    return `${offer.storeLabel} — ${offer.name} ${aud(offer.price)}${cup}${unit}${stats}${special}${stock}`;
  });
  const observedAt =
    priced.length > 0 && priced.every(offer => offer.observedAt === priced[0].observedAt)
      ? priced[0].observedAt : null;
  void at; // Retrieval time must never substitute for a missing source date.
  const sourceRef = priced.find((offer) => offer.url)?.url ?? "https://www.whichgrocer.com/";
  return {
    claim: claim.slice(0, 180),
    detail: `${lines.join(". ")}. WhichGrocer catalogue prices, not a single shop's till price.`.slice(0, 700),
    sourceRef,
    observedAt,
  };
}
