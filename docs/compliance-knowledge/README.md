# Local compliance knowledge base (Step A)

This is the evidence-storage and retrieval layer. It does not yet connect to the compliance agent, change review outcomes, approve ads, or search online. The separate JSON rule registry includes a small, manually reviewed official-source starter set for AU, NZ, UK and US; it is not a complete legal library and does not import the source documents into this knowledge base.

## Setup and import

Use Node 22.13+ with node:sqlite and TypeScript stripping (verified here with Node 25). If your shell selects Node 16, run `export PATH=/opt/homebrew/bin:$PATH` first.

1. Download a source document you have verified, in PDF, UTF-8 text or Markdown format.
2. Create a local maintainer-owned allow-list, for example `data/compliance-sources.json`:

```json
{"authorisedSources":["https://publisher.example/path/to/document"]}
```

Use the document's actual original URL. This exact-URL allow-list is separate from the existing rule registry's source-name allow-list. Do not populate it from advertisement uploads or model responses. Listing a URL is a maintainer trust decision, not automatic verification of the file's provenance.

3. Create a metadata JSON file based on `metadata.example.json`. Replace all placeholder values. Effective dates may be null when unknown; unknown applicability is returned as a retrieval warning. `reviewAfter` is your next source-review deadline, not an invented legal expiry date. `effectiveTo` is only for a known end of applicability.
4. Configure and import:

```sh
export AISLE_COMPLIANCE_KB_SOURCES_FILE="$PWD/data/compliance-sources.json"
npm run compliance:kb -- ingest /absolute/path/document.pdf /absolute/path/metadata.json
npm run compliance:kb -- list
npm run compliance:kb -- search AU "discount price conditions" web
```

The default SQLite database is `data/compliance-knowledge.db` (already gitignored). Set `AISLE_COMPLIANCE_KB_DB` to override it. Environment variables can also be placed in `.env.local` for this CLI. Back up the SQLite database using SQLite-aware backup tooling when it is in use.

## Stored evidence and versions

Each import stores the original file bytes, SHA-256 hash, metadata, import timestamp and extracted passages in one transaction. PDF citations retain page numbers; text/Markdown citations retain line numbers and Markdown headings. Long passages have overlapping chunks and character ranges. Citation IDs are stable for identical document versions.

A document ID identifies one policy/document across versions. Reimporting identical bytes and metadata is idempotent. A changed file or metadata requires a new version. Every successful new version becomes the active revision for that document ID; old versions and passages remain stored. Import versions in the desired activation order. Reimporting an existing old version does not reactivate it. An updated check date also requires a new snapshot version. There is no automatic refresh or scheduler in Step A.

## Retrieval contract

`KnowledgeStore.search(query, options)` returns `passages` and `problems`. It filters by active revision, jurisdiction, optional platform and document kind, current source authorisation and dates. Overdue, future-dated and expired documents are excluded. A missing effective-from date produces a warning. Callers must propagate problems to reviewers, not discard them.

FTS5 ranks lexical matches locally. Retrieval scores are relevance scores, not legal risk or confidence. A query with no results does not prove compliance; a matching passage does not establish legal applicability. Current matching is keyword-based, not embedding-based, and may miss synonyms. Future agent integration should query multiple relevant concepts and retain the exact returned passages on each review.

Supported kinds: legislation, regulator_guidance, platform_policy, brand_policy, case. Keep case comparison separate from treating a source as a binding rule. The index deliberately does not invent rule mappings or convert arbitrary legal sentences into forbidden-phrase checks.

Limits: 25 MiB per file, 1,000 PDF pages, no OCR, no image understanding, no HTML/DOCX importer. PDFs containing pages without extracted text are rejected for manual/OCR checking; successful text extraction still requires checking reading order and completeness. Ingestion is a trusted local maintainer operation, not a public endpoint. Retrieved documents are evidence data, never agent instructions.

## Verification

```sh
npm run test:compliance-knowledge
npm run typecheck
```

The test suite uses synthetic temporary documents and databases. It checks authorisation, version immutability, persistence, scoped retrieval, stale-source exclusion, unknown-date warnings, citations and query handling. It does not validate legal coverage or certify PDF extraction quality for arbitrary documents.
