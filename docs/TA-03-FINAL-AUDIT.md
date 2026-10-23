# TA-03 release audit — 23 October 2026

Scope: SCRUM-29 under SCRUM-14, existing branch `codex/ta03-authorised-evidence`. TA-01/02 Jira issues remain unchanged. The user authorised publishing this branch and merging into main after verification. Preserve all newer teammate changes during that merge.

## Acceptance results

| TA-03 requirement | Evidence / outcome |
| --- | --- |
| Authorised external source end to end | PASS: existing model-provider scoped search, direct allowlisted primary-page extraction and Nager.Date calendar work in two real campaigns. No new paid-service subscription is required. |
| Every required category and selected channel checked | PASS: both real campaigns have eight independently scoped mandatory areas and eight recorded draft assessments. Grocery uses web; Apparel uses email. Distinct queries and source URLs reflect those scopes. |
| Autonomous tool routing and grounded analysis | PASS: both real traces show model-selected `web.scrape_page` and `calendar.public_holidays`, actual execution, returned evidence IDs and citations from both types. Two model turns per scenario; no argument-validation failures. |
| Typed specialist adapters | Implemented and fixture-tested: Firecrawl Search/Scrape, SerpApi Trends, ABS metadata/series, holiday/forecast/historical weather, WhichGrocer products/equivalents/specials/price statistics. Missing access and rejected non-production metadata remain visible limitations. Authenticated SerpApi/WhichGrocer success is not claimed without credentials. |
| Provenance and permissions | PASS: source/item IDs, URLs, retrieval times, explicit unknown information dates, category/geography/transformations, allowlists, private-URL rejection, explicit internal consent and redaction. |
| No fabricated completeness | PASS: actual reports remain PARTIAL where data is inadequate, unknown dates remain unknown, and creative handoff/approved claims stay blocked. A recorded no-citation limitation is an assessed evidence gap, not a supported finding. |
| Bounds and shared runtime | PASS: shared LangChain/MeteredChatModel/billing; 32 tool attempts, six model turns, conservative 48,000-token envelope including the next request/output reservation, 4,000 output tokens per turn, elapsed-time and research-cost guards, pause and same-run cache. |
| Schema / result feedback | PASS: actual Zod-to-JSON-Schema conversion retains enums, required fields and strict keys. Provider-safe names survive changing tool lists and multi-turn history. Tool feedback is bounded; full evidence remains in the engine. |
| Internal aggregate CSV and repeat research | PASS: validated SKU/category/week/units input with provenance, explicit permission, category aggregation and no raw rows sent to the model. A new authorised export on explicit rerun survives durable storage reopen; browser scope/approval changes are rejected. |
| Report and attention UI | Global Trends: report library, attention queue, collapsed source workspace. Campaign Trends: all eight areas/per-channel records, sources/dates, assessments, findings, opportunities/risks, themes/visual directions, limitations and why/action/impact. Legacy samples are labelled. No research approval can waive gaps; advertising approval is separate. |
| Responsive / semantic / legacy UI | 390px browser check shows all eight headings and document width 390px, with no horizontal page overflow. Sections/links/details have semantic labels. Legacy/no-run report does not look verified. |
| No-credentials operation | PASS: normal server runtime makes no outbound request, spends no inference credit, records gaps and blocks handoff. |

The TA-03 delivery claim is the retrieval/analysis integration and truthful report/input workflow above. TA-04 sufficiency certification, TA-05/06 final prioritisation/synthesis and broader TA-09 decision handling are separate owners explicitly referenced in Jira; this audit does not claim the entire UC-02 success scenario is complete. An unavailable data source is an expected recorded limitation, not permission to fabricate a complete market report.

## Reproducible evidence

`docs/TA-03-ACCEPTANCE-SUMMARY.json` contains the two real models/tool traces, category counts, cited evidence IDs, public URLs and application cost estimates without credentials or third-party excerpts. Detailed local `TA-03-LIVE-ACCEPTANCE*.json` transcripts remain ignored. Earlier failed runs are retained there; the final release trace supersedes them.

Final release checks and integration outcome are recorded below after merging current main. No forced ref update is allowed.

## Integration verification

Merged current `origin/main` at `539d5e72fe74e16abd32aa03f144f7b1ed91cd0a`, preserving the teammate compliance checker, separate approvals tab, structured copy and poster-revision paths. The research factory augments that shared runtime rather than replacing its other agents. Research links still open the research tab; advertising review links now open the separate approvals tab.

Post-merge checks passed: research 15, provider search 4, evidence 11, WhichGrocer 13, graph 2, bench 15 scenario groups, workflow 15, agents 9, connection 17 (main intentionally removed the old default-off test), plus compliance/report/knowledge/rules suites. TypeScript, targeted ESLint, diff checks and production webpack build passed. Existing unpdf import.meta and workspace-root warnings do not prevent the build. A local scan found no configured secret values in tracked files.

TA-03 release verification passed for the agreed existing-provider path and expected blocked/partial cases. Preserve the documented specialist-access limitations and downstream ownership; no complete-market-evidence claim or publication approval is implied.
