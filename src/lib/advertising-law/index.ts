import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { BrandProfile, Country } from "@/lib/types";

const ROOT = path.join(process.cwd(), "services/knowledge/law");

const MARKETS: Record<Country, string> = {
  AU: "Australia",
  NZ: "New Zealand",
  UK: "United Kingdom",
  US: "United States",
};

/** Australia is the only market with a built index. The others stay empty until their own documents are added. */
const AU_DOCUMENTS = [
  {
    file: "competition-and-consumer-act-2010-volume-4.txt",
    title: "Competition and Consumer Act 2010, Compilation No. 164 (27 May 2026), Volume 4 Schedules",
    url: "https://www.legislation.gov.au/C2004A00109/2026-05-27/2026-05-27/text/original/pdf/4",
  },
  {
    file: "accc-advertising-and-selling-guide-july-2021.txt",
    title: "ACCC Advertising and selling guide (July 2021)",
    url: "https://www.accc.gov.au/system/files/Advertising%20and%20selling%20guide%20-%20July%202021.pdf",
  },
  {
    file: "accc-making-environmental-claims-december-2023.txt",
    title: "ACCC Making environmental claims (December 2023)",
    url: "https://www.accc.gov.au/system/files/greenwashing-guidelines.pdf",
  },
  {
    file: "country-of-origin-food-labelling-information-standard-2016.txt",
    title: "Country of Origin Food Labelling Information Standard 2016, Compilation No. 2 (12 August 2017)",
    url: "https://www.legislation.gov.au/F2016L00528/latest",
  },
  {
    file: "copyright-act-1968-compilation-65.txt",
    title: "Copyright Act 1968, Compilation No. 65 (2 April 2026)",
    url: "https://www.legislation.gov.au/C1968A00063/2026-04-02/2026-04-02/text/original/pdf",
  },
  {
    file: "spam-act-2003-compilation-10.txt",
    title: "Spam Act 2003, Compilation No. 10 (10 March 2016)",
    url: "https://www.legislation.gov.au/C2004A01214/2016-03-10/2016-03-10/text/original/pdf",
  },
  {
    file: "aana-code-of-ethics-2021.txt",
    title: "AANA Code of Ethics (effective 1 February 2021)",
    url: "https://aana.com.au/code-of-ethics/",
  },
] as const;

const CHUNK_CHARS = 1600;
const CHUNK_OVERLAP = 200;
const STOP = new Set(
  "a an the of and or to in for on with by from at as is be are was were this that these those which into it its their his her you your we our not no".split(" "),
);

type LawPassage = {
  title: string;
  url: string;
  page: number;
  text: string;
  score: number;
};

type Chunk = LawPassage & { terms: Map<string, number>; length: number };
type LawIndex = { chunks: Chunk[]; df: Map<string, number>; avg: number };

const cache = new Map<Country, LawIndex>();

function tokens(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((term) => term.length > 1 && !STOP.has(term));
}

function windows(page: string): string[] {
  const clean = page.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  if (clean.length <= CHUNK_CHARS) return [clean];
  const parts: string[] = [];
  for (let start = 0; start < clean.length; start += CHUNK_CHARS - CHUNK_OVERLAP) {
    const slice = clean.slice(start, start + CHUNK_CHARS).trim();
    if (slice) parts.push(slice);
    if (start + CHUNK_CHARS >= clean.length) break;
  }
  return parts;
}

function chunksFrom(title: string, url: string, text: string): Chunk[] {
  const chunks: Chunk[] = [];
  text.split("\f").forEach((page, index) => {
    for (const body of windows(page)) {
      const counts = new Map<string, number>();
      for (const term of tokens(body)) counts.set(term, (counts.get(term) ?? 0) + 1);
      if (counts.size === 0) continue;
      chunks.push({
        title,
        url,
        page: index + 1,
        text: body,
        score: 0,
        terms: counts,
        length: [...counts.values()].reduce((sum, n) => sum + n, 0),
      });
    }
  });
  return chunks;
}

function documentsFor(country: Country) {
  if (country !== "AU") return [];
  return AU_DOCUMENTS.map((doc) => ({ ...doc, path: path.join(ROOT, "AU", "text", doc.file) }));
}

/** The market's own law index. Australia is built. Other markets are not, and are not filled with Australian law. */
export function marketLaw(country: Country): { label: string; ready: boolean } {
  const docs = documentsFor(country);
  return {
    label: MARKETS[country],
    ready: docs.length > 0 && docs.every((doc) => existsSync(doc.path)),
  };
}

function indexFor(country: Country): LawIndex | null {
  const hit = cache.get(country);
  if (hit) return hit;
  const docs = documentsFor(country);
  if (!docs.length || !docs.every((doc) => existsSync(doc.path))) return null;
  const chunks = docs.flatMap((doc) => chunksFrom(doc.title, doc.url, readFileSync(doc.path, "utf8")));
  const df = new Map<string, number>();
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.length;
    for (const term of chunk.terms.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const index = { chunks, df, avg: chunks.length ? total / chunks.length : 1 };
  cache.set(country, index);
  return index;
}

function scoreQuery(index: LawIndex, chunks: Chunk[], query: string, k: number): LawPassage[] {
  const queryTerms = tokens(query);
  if (!queryTerms.length || !chunks.length) return [];
  const unique = [...new Set(queryTerms)];
  const k1 = 1.2;
  const b = 0.75;
  const n = index.chunks.length;
  const ranked = chunks
    .map((chunk) => {
      let score = 0;
      for (const term of unique) {
        const tf = chunk.terms.get(term);
        if (!tf) continue;
        const df = index.df.get(term) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        const denom = tf + k1 * (1 - b + b * (chunk.length / index.avg));
        score += idf * ((tf * (k1 + 1)) / denom);
      }
      return { ...chunk, score };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: LawPassage[] = [];
  for (const chunk of ranked) {
    const key = `${chunk.title}:${chunk.page}:${chunk.text.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: chunk.title, url: chunk.url, page: chunk.page, text: chunk.text, score: chunk.score });
    if (out.length >= k) break;
  }
  return out;
}

const CORE_QUERIES: { title: string; query: string; limit: number }[] = [
  { title: "Competition and Consumer Act", query: "misleading or deceptive conduct false or misleading representation goods services", limit: 2 },
  { title: "Copyright Act 1968", query: "copyright infringement reproduction artistic literary musical work", limit: 2 },
  { title: "Spam Act 2003", query: "commercial electronic message consent unsubscribe", limit: 2 },
  { title: "AANA Code of Ethics", query: "internet social media discrimination violence sex language health safety", limit: 2 },
];

/** Search only that market's index. A missing market returns nothing. */
export function retrieveAdvertisingLaw(country: Country, copy: string): LawPassage[] {
  const index = indexFor(country);
  if (!index) return [];
  const poster = scoreQuery(index, index.chunks, copy, 4);
  const core = CORE_QUERIES.flatMap((item) => {
    const chunks = index.chunks.filter((chunk) => chunk.title.startsWith(item.title));
    return scoreQuery(index, chunks, item.query, item.limit);
  });
  const merged: LawPassage[] = [];
  const seen = new Set<string>();
  for (const passage of [...poster, ...core]) {
    const key = `${passage.title}:${passage.page}:${passage.text.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(passage);
  }
  return merged.slice(0, 12);
}

/** The retailer's saved profile. It is the brand policy for this review, not a statute. */
export function storedBrandPolicy(brand: BrandProfile): string {
  const countries = Object.entries(brand.countryRules ?? {})
    .map(([country, rule]) => `${country}: ${rule}`)
    .join("\n");
  return [
    `Retailer brand profile stored for ${brand.retailerName}. Apply this profile to the advertisement. It is the brand's own instruction, not a statute.`,
    `Tone: ${brand.tone}`,
    brand.visualStyle ? `Visual style: ${brand.visualStyle}` : "",
    `Approved terms: ${brand.approvedTerms.join(", ") || "none recorded"}.`,
    `Banned terms: ${brand.bannedTerms.join(", ") || "none recorded"}.`,
    countries ? `Country notes stored with the brand:\n${countries}` : "",
  ].filter(Boolean).join("\n");
}

export function formatLawPassages(country: Country, passages: LawPassage[]): string {
  if (!passages.length) return "";
  const { label } = marketLaw(country);
  return [
    `Passages retrieved from the ${label} (${country}) advertising-law index. They are not the whole of any document.`,
    ...passages.map(
      (passage, index) =>
        `[${index + 1}] ${passage.title}, PDF page ${passage.page}\n${passage.url}\n${passage.text}`,
    ),
  ].join("\n\n");
}
