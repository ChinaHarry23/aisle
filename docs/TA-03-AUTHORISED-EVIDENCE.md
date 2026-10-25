# TA-03 local implementation — 21 October 2026

Implementation on `codex/ta03-authorised-evidence`; commit and branch push authorised by Danting on 21 October 2026. Not deployed or accepted as fully complete. TA-01 and TA-02 Jira issues remain unchanged.

## Required research coverage

The Stage 1 AHR-02 and UC-02 step 6 require current and historical market trends, customer interests and purchasing preferences, seasonal and cultural influences, each selected channel, and public competitor activity. The application's eight categories split the report's grouped concepts so neither half can disappear. They are not the seven final TrendFinding categories.

Every category/channel now receives a separate, serial, permission-checked request before optional enrichment. Historical market and customer interest use Trends TIMESERIES/RELATED_QUERIES, with same-category public search fallback. Other categories use scoped public search. Search snippets trigger one original-page extraction per area. Cultural research also reads the campaign-year holiday calendar. Holidays alone cannot establish cultural preferences; weather remains optional. Authorised aggregate retail uploads add purchase observations.

This mandatory first pass is a deliberate change requested by Danting: the model still chooses additional tools/arguments and analyses returned records, but cannot omit required collection merely by returning an early final answer. All actions use the same guarded execution ledger and cache. It does not invoke the old five-source path again.

## Existing API reuse

`web.search` uses Firecrawl when configured. Otherwise the server can reuse the existing `searchWithModel` OpenAI/Claude provider web-search adapter and the existing model credential, authenticated billing identity, and selected model. The provider/relay must support that search endpoint. It is not ordinary model recall. Only allowlisted citation excerpts/titles become source candidates; generated search prose is excluded from evidence.

`web.scrape_page` uses Firecrawl when configured; otherwise it fetches bounded allowlisted public HTML/plain text directly, without redirects or browser execution. Scripts/styles are removed; unknown publication dates remain unknown. PDFs, login walls, dynamic pages and unavailable pages remain gaps.

SerpApi and WhichGrocer require their own access for their specialised data. Google Trends is relative interest, not sales. ABS discovery checks dataflow metadata and dimensions before requesting a bounded series. A live metadata conflict around non-production flags remains unresolved; no current spending fact is certified from that probe.

## Report and completion

Campaign data stores `researchAttempts`, `researchCoverage`, evidence IDs, and optional per-category `researchAnalysis`. The report displays each area even for old runs with no execution record, each attempted tool/result, source text/URL, retrieval time, information date or unknown, and limitations. A unique analysis with category-matching returned citation IDs can populate a draft assessment. An explicit no-citation limitation can be displayed only as an assessed evidence gap. Invalid or cross-category citation IDs are rejected; general market assessments do not acquire a separate channel dimension merely because the model repeats the selected channel. This syntactic check does not certify semantic support.

The research decision receives the collected records and is instructed to return every category/channel. Missing model access or omitted analysis leaves an explicit incomplete area. TA-04 evidence sufficiency and TA-05/06 prioritisation/final synthesis remain separate acceptance work. This implementation conservatively retains PARTIAL and blocks creative handoff; it does not pretend all of AHR-02 is complete.

## Internal aggregate CSV

An authenticated import endpoint and Trends-panel consent/upload control accept exactly `sku,category,week,units`, at most 1 MB and 10,000 rows. Additional customer columns, invalid dates and negative/non-numeric units are rejected. Store only validated aggregate rows plus SHA-256 file provenance and import time, not raw CSV or its filename. Explicit campaign permission is checked again when reading. Only matching-category observed rows are summed by week; SKU rows are excluded from model tool results and external searches. These measurements are not population-wide preference or causal demand proof.

## Bounds and configuration

Maximum 32 uncached tool attempts, six model turns, 48,000-token conservative envelope (including a conservative reservation for the next request and 4,000 output tokens) and 180 seconds checked before each action. In-flight requests have their own timeout; the run timer does not forcibly abort an already-running model request. Source policy, pause, argument schema, campaign remaining budget and same-run cache are checked by application code.

Provider prices are not invented. Configure conservative per-call USD charges in `TREND_PROVIDER_SEARCH_MAX_USD`, `TREND_FIRECRAWL_SEARCH_MAX_USD`, `TREND_FIRECRAWL_SCRAPE_MAX_USD`, `TREND_SERPAPI_MAX_USD`, and `TREND_WHICHGROCER_MAX_USD` for paid paths being used. `TREND_RESEARCH_MAX_USD` bounds research charges. Provider-search conservative charges include possible model/search service fees and may apply even after an ambiguous failed response; this is an estimate, not the provider invoice. Keys remain server-side. Missing settings create explicit blocked records, never fabricated evidence.

## Verification and outstanding acceptance

- Synthetic adapter/agent/coverage/CSV tests: `npm run test:trend-research`; provenance and handoff regression: `npm run test:trend-evidence`.
- `docs/TA-03-MOCK-RESEARCH.json` records mock model traces, not live AI runs.
- `docs/TA-03-PUBLIC-SOURCE-PROBE.json` records actual free public-source probes, not complete research or real-model analysis.
- WhichGrocer product/equivalent lookup is retained. Specials search and product price statistics now use the official OpenAPI 2.7.0 contract inspected on 21 October 2026: `/v2/specials/search` and `/v2/products/{id}` with `price_stats`. Product IDs must come from returned campaign evidence. Trailing 30-day statistics are not a historical time series; specials do not establish a retailer promotion period or local stock. Stale/archived records remain stale, and attribution is displayed. Fixture checks pass; authenticated live acceptance remains pending. Reference: https://www.whichgrocer.com/developers/docs
- Full selected-model/provider end-to-end acceptance is NOT demonstrated without working credentials, supported search API/relay, authenticated credits and configured cost bounds.
- No Jira issue has been marked complete. See the final audit and Git history for validation and delivery.

## Report UI responsibilities — 21 October 2026

Global `/trends` is the cross-campaign report library and research-attention queue.
Source configuration remains available in a collapsed workspace below the reports.
`/campaigns/[id]?tab=research` is the detailed campaign report: visible cards for
all mandatory research areas, expandable source/attempt details, conclusions,
prioritised findings, opportunities, risks, themes, visual directions and limitations.
The separate attention section states why input is needed, its impact and next actions.
Advertising approval links explicitly target the compliance tab; a research gap is
never cleared by an advertising approval or by UI counters. The current data model
has no certified COMPLETE report state or evidence-waiver approval. The UI labels draft/not-run honestly. A paused campaign can explicitly rerun research after a validated authorised export is attached; durable workflow storage preserves that input without accepting browser changes to approved scope or runtime results. TA-04/09 sufficiency and broader decision acceptance remain separate.

These UI requirements were appended to existing SCRUM-29 (TA-03), preserving its
previous description, parent SCRUM-14, and In Progress status. No other issue changed.

## Agent routing repair — 23 October 2026

DynamicStructuredTool Zod schemas are converted to actual JSON Schema before transport, retaining enum values, required arguments and strict object keys. The initial coverage pass performs one scoped request per area/channel; the model selects original-page and specialist follow-up tools itself. Collection offers only real external tools with required tool choice until two distinct types execute. Assessment then offers the final schema without more research tools. Primitive numeric/string formatting is normalised before LangChain validation; unknown keys and invalid enum values are still rejected. Per-turn offered/selected tool names, validation outcomes and usage are recorded without private prompt contents. Full source outcomes remain in the engine, while feedback to the model is bounded and does not duplicate the same data as evidence. Unvalidated findings do not inherit fixed confidence percentages from the legacy path.
