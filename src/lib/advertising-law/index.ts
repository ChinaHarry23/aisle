import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { Country } from "@/lib/types";

const ROOT = path.join(process.cwd(), "services/knowledge/law");

const MARKETS: Record<Country, { label: string }> = {
  AU: { label: "Australia" },
  NZ: { label: "New Zealand" },
  UK: { label: "United Kingdom" },
  US: { label: "United States" },
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
] as const;

const CHUNK_CHARS = 1600;
const CHUNK_OVERLAP = 200;
const STOP = new Set(
  "a an the of and or to in for on with by from at as is be are was were this that these those which into it its their his her you your we our not no".split(" "),
);

export type LawPassage = {
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
export function marketLaw(country: Country): { country: Country; label: string; ready: boolean } {
  const label = MARKETS[country].label;
  const docs = documentsFor(country);
  return {
    country,
    label,
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

/** Search only that market's index. A missing market returns nothing. */
export function retrieveAdvertisingLaw(country: Country, copy: string): LawPassage[] {
  const index = indexFor(country);
  if (!index) return [];
  const poster = scoreQuery(index, index.chunks, copy, 5);
  const act = index.chunks.filter((chunk) => chunk.title.startsWith("Competition and Consumer Act"));
  const core = scoreQuery(index, act, "misleading or deceptive conduct false or misleading representation goods services", 2);
  const merged: LawPassage[] = [];
  const seen = new Set<string>();
  for (const passage of [...poster, ...core]) {
    const key = `${passage.title}:${passage.page}:${passage.text.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(passage);
  }
  return merged.slice(0, 8);
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
