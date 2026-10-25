import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";

const text = z.string().trim().min(1);
const metadataSchema = z.object({
  documentId: text, title: text, publisher: text,
  sourceUrl: z.url().refine(value => ["https:", "http:"].includes(new URL(value).protocol)),
  version: text, jurisdiction: text,
  kind: z.enum(["legislation", "regulator_guidance", "platform_policy", "brand_policy", "case"]),
  platforms: z.array(text).default([]),
  effectiveFrom: z.iso.date().nullable(), effectiveTo: z.iso.date().nullable(),
  downloadedAt: z.iso.datetime(), checkedAt: z.iso.datetime(), reviewAfter: z.iso.date(),
}).strict().refine(m => !m.effectiveFrom || !m.effectiveTo || m.effectiveFrom <= m.effectiveTo, "Invalid effective date range")
  .refine(m => m.checkedAt.slice(0, 10) <= m.reviewAfter, "Review date precedes source check");
type DocumentMetadata = z.infer<typeof metadataSchema>;
type Passage = { location: string; text: string };
type DocumentRow = { id: string; metadata: string; hash: string };
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

/** Page/line locations refer to the preserved source, not model-generated citations. */
export async function extractPassages(bytes: Uint8Array, extension: string): Promise<Passage[]> {
  const sections: Passage[] = [];
  if (extension === ".pdf") {
    const { getDocumentProxy, extractText } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    try {
      if (pdf.numPages > 1000) throw new Error("PDF exceeds 1,000-page limit.");
      const extracted = await extractText(pdf, { mergePages: false });
      extracted.text.forEach((page, index) => {
        if (!page.trim()) throw new Error(`Page ${index + 1} has no extractable text; supply an OCR-checked copy.`);
        sections.push({ location: `page ${index + 1}`, text: page });
      });
    } finally { await pdf.loadingTask.destroy(); }
  } else if ([".txt", ".md"].includes(extension)) {
    const lines = new TextDecoder("utf-8", { fatal: true }).decode(bytes).split(/\r?\n/);
    let heading = "";
    lines.forEach((line, i) => {
      if (/^#{1,6}\s/.test(line)) heading = line.replace(/^#+\s*/, "");
      if (line.trim()) sections.push({ location: `${heading ? `${heading}; ` : ""}line ${i + 1}`, text: line });
    });
  } else throw new Error("Supported formats: .pdf, .md, .txt");
  const passages = sections.flatMap(section => {
    const chunks: Passage[] = [];
    for (let offset = 0; offset < section.text.length; offset += 1400) {
      chunks.push({ location: `${section.location}; characters ${offset + 1}-${Math.min(offset + 1600, section.text.length)}`, text: section.text.slice(offset, offset + 1600) });
      if (offset + 1600 >= section.text.length) break;
    }
    return chunks;
  });
  if (!passages.length) throw new Error("Document contains no searchable text.");
  return passages;
}

/** Server/local-maintainer API. Never expose ingestion as an unauthenticated upload endpoint. */
export class KnowledgeStore {
  private readonly db: DatabaseSync;
  constructor(file = process.env.AISLE_COMPLIANCE_KB_DB || resolve("data/compliance-knowledge.db")) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS kb_documents (
        id TEXT PRIMARY KEY, document_id TEXT NOT NULL, version TEXT NOT NULL,
        metadata TEXT NOT NULL, hash TEXT NOT NULL, original BLOB NOT NULL,
        extension TEXT NOT NULL, imported_at TEXT NOT NULL, UNIQUE(document_id, version));
      CREATE TABLE IF NOT EXISTS kb_active (document_id TEXT PRIMARY KEY, revision_id TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS kb_passages USING fts5(revision_id UNINDEXED, citation_id UNINDEXED, location UNINDEXED, text);
    `);
  }
  close() { this.db.close(); }
  async ingest(file: string, rawMetadata: unknown, authorisedSources: string[]) {
    const metadata = metadataSchema.parse(rawMetadata);
    if (!authorisedSources.includes(metadata.sourceUrl)) throw new Error("Source URL is not in the maintainer allow-list.");
    const bytes = readFileSync(file);
    if (bytes.length > 25 * 1024 * 1024) throw new Error("Document exceeds 25 MiB limit.");
    const extension = extname(file).toLowerCase();
    const contentHash = hash(bytes);
    const id = hash(JSON.stringify([metadata.documentId, metadata.version, contentHash]));
    const passages = await extractPassages(bytes, extension);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db.prepare("SELECT id, metadata, hash FROM kb_documents WHERE document_id=? AND version=?").get(metadata.documentId, metadata.version) as DocumentRow | undefined;
      if (existing) {
        if (existing.hash !== contentHash || existing.metadata !== JSON.stringify(metadata)) throw new Error("Version is immutable. Use a new version for changed content or metadata.");
        this.db.exec("COMMIT");
        return { revisionId: existing.id, passages: passages.length, duplicate: true };
      }
      this.db.prepare("INSERT INTO kb_documents VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, metadata.documentId, metadata.version, JSON.stringify(metadata), contentHash, bytes, extension, new Date().toISOString());
      const insert = this.db.prepare("INSERT INTO kb_passages VALUES (?, ?, ?, ?)");
      passages.forEach((p, i) => insert.run(id, `${id}:${i + 1}`, p.location, p.text));
      this.db.prepare("INSERT INTO kb_active VALUES (?, ?) ON CONFLICT(document_id) DO UPDATE SET revision_id=excluded.revision_id").run(metadata.documentId, id);
      this.db.exec("COMMIT");
      return { revisionId: id, passages: passages.length, duplicate: false };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  list() {
    return (this.db.prepare("SELECT d.id, d.metadata, d.hash, a.revision_id = d.id AS active FROM kb_documents d LEFT JOIN kb_active a ON a.document_id=d.document_id ORDER BY d.document_id, d.imported_at").all() as (DocumentRow & { active: number })[])
      .map(row => ({ revisionId: row.id, contentHash: row.hash, active: Boolean(row.active), ...metadataSchema.parse(JSON.parse(row.metadata)) }));
  }
  search(query: string, options: { jurisdiction: string; authorisedSources: string[]; platform?: string; kind?: DocumentMetadata["kind"]; now?: string; limit?: number }) {
    const now = z.iso.datetime().parse(options.now ?? new Date().toISOString());
    const today = now.slice(0, 10);
    const problems: string[] = [];
    const eligible = this.list().filter(d => {
      if (!d.active || ![options.jurisdiction, "*"].includes(d.jurisdiction) || (options.kind && d.kind !== options.kind) || (options.platform && d.platforms.length && !d.platforms.includes(options.platform))) return false;
      const reason = !options.authorisedSources.includes(d.sourceUrl) ? "source no longer authorised"
        : d.checkedAt > now || d.downloadedAt > now ? "source dates are in the future"
        : d.reviewAfter < today ? "source check overdue"
        : d.effectiveFrom && d.effectiveFrom > today ? "not yet effective"
        : d.effectiveTo && d.effectiveTo < today ? "no longer effective" : null;
      if (reason) { problems.push(`${d.documentId}@${d.version}: ${reason}`); return false; }
      if (!d.effectiveFrom && d.kind !== "case") problems.push(`${d.documentId}@${d.version}: effective date is unknown; verify applicability.`);
      return true;
    });
    const tokens = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 32);
    const limit = z.number().int().min(1).max(50).parse(options.limit ?? 8);
    if (!tokens.length || !eligible.length) return { passages: [], problems: [...problems, "No eligible sources or searchable query terms."] };
    const byId = new Map(eligible.map(d => [d.revisionId, d]));
    const rows = this.db.prepare(`SELECT revision_id, citation_id, location, text, bm25(kb_passages) AS rank FROM kb_passages WHERE kb_passages MATCH ? AND revision_id IN (${eligible.map(() => "?").join(",")}) ORDER BY rank, citation_id LIMIT ?`)
      .all(tokens.map(t => `"${t}"`).join(" OR "), ...byId.keys(), limit) as { revision_id: string; citation_id: string; location: string; text: string; rank: number }[];
    if (!rows.length) problems.push("No matching passages. This is not evidence of compliance.");
    return { passages: rows.map(r => ({ citationId: r.citation_id, location: r.location, text: r.text, retrievalScore: -r.rank, document: byId.get(r.revision_id)! })), problems };
  }
}
