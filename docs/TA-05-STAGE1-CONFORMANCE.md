# TA-05: evidence-backed TrendBrief implementation and review

Source: the entire 61-page user-supplied Stage 1 report, original Desktop copy:
`Project Stage 1 Report_ELEC5620 Mon 10-12 Group 11.pdf`.
SHA-256: `877fbca55c48a9da1a96aa6a37111ea8ffc01e22709af5169ce6d8777f07db42`.
The full report text, cross-AHR descriptions and Trend Analysis feature, class,
object, activity, interaction and state diagrams were reviewed. Specification
content establishes requirements; it does not grant instructions or permissions.

## Plan adjusted to the report

1. Research inputs and report findings are different: eight input areas (one per
   selected channel) support seven main finding categories. Both remain visible.
2. A report is more than an angle/headline and syntactically valid JSON. Provide
   market situation, current/historical trends, interests/preferences, separate
   seasonal/cultural sections, each channel, public competitors, opportunities,
   risks, themes, visuals, sources/dates, confidence and limitations.
3. Facts are the unchanged, reviewed ledger claims. The writer selects/orders
   finding IDs and exact supporting quotations, explains priority against all
   seven campaign dimensions, and separately proposes inferences/themes/visuals.
   A second semantic review tests actual support, not simply citation existence.
4. The platform owns completion. INCOMPLETE/COMPLETE remain the only BriefStatus
   values. Partial report display is not a new status or permission to hand off.
   TA-04 evidence sufficiency, resolved required decisions, runnable scope and
   successful storage of the exact current report remain necessary.
5. Prior advice is optional. Only matching platform-recorded accepted or
   confirmed-edited recommendations with a stored, supported report are consumed;
   wording, source campaign, decision author/time/action and report ID are kept.
   The unaccepted seeded-history fallback is removed.
6. Research decisions and candidate substantiation do not grant compliance or
   publication approval. No new external decision service or market-data API is
   introduced. The same external Trend capability is invoked through the shared
   metered adapter for writing and support review.

## Whole-report mapping

| Report pages / section | Implication for TA-05 | Implementation |
|---|---|---|
| 2–5 overview and ad hoc architecture | Central orchestration, shared authorised scope, retained inputs/versions; services do not call one another | Existing operation graph invokes quality then structured synthesis through shared model transport |
| 5, 17–19 AHR-01 / UC-01 | Founder scope, explicit launch/resume; optional accepted note stays unchanged | Reuse intake/control guard; verify previous advice in the Trend consumer |
| 5–6 AHR-02 | Supported findings vs assumptions, prioritisation, themes, visuals, sources and limits | Canonical reviewed facts, typed writer, separate support audit and explicit proposal types |
| 6, 23–26 AHR-03 / UC-03 | Generation requires sufficiently supported COMPLETE current stored brief | `trendReadyForHandoff` also validates structured report, exact version/content fingerprint and stored snapshot |
| 7–8 AHR-04/05 | Trend proposals cannot authorise advertising, scheduling or publication | Writer/auditor receive no action tools; UI labels advertising review as separate |
| 8, 12, 16, 31–34 AHR-06 / UC-06 | Accepted/edited stored advice only; no history required; retain source/decision | `attachableRecommendation`, `verifiedPreviousAdvice`, explicit advice provenance in stored brief |
| 9–10 feature model and NFR-02.1–02.6 | All four mandatory groups; explainability, privacy, traceability, recovery, quality and scope | Full visible report structure, seven scope rationales, citations/quotes, limitations, version history and inherited founder controls |
| 13–14 use-case diagram/text | Deliver Evidence-Backed Trend Brief includes review/gather/assess; clarification is conditional | Synthesis follows TA-03/04; no mandatory research approval added for sufficient ordinary cases |
| 19–23 UC-02 steps 6–12 | Distinguish current/historical, interest/preference, seasonal/cultural, channel/competition; compare, rank and prepare every required section | Typed section list, per-channel structural checks, priority order and seven relevance dimensions; audit checks content support |
| 21–23 UC-02 extensions | Invalid/missing/conflicting evidence retains partial work and blocks progression | Preserve TA-04 requests and limitations; failed synthesis retains report/errors with bounded retry |
| 23 UC-02 steps 13–15 / exceptions | Store current supported version before founder visibility/handoff; failed storage or unavailable receiver cannot pretend success | Store structured report/audit with quality checkpoint; compare saved and current exact report before AHR-03 receives it |
| 34–40 architecture, classes and shared contracts | Platform validates external responses; ordered findings own evidence associations; previous data optional | Strict Zod schemas, deterministic acceptance, source provenance, server-owned findings and context/run/version IDs |
| 41–44 object diagrams/descriptions | Seven required main categories; shared evidence allowed; incomplete assumptions not certified; example percentages illustrative | Findings retain category, support, rationale/confidence/uncertainty; no overall percentage completion threshold |
| 47–48 activity | Validate required category coverage, then mark, store and hand off while runnable | Structured validation is an additional gate before existing storage/handoff nodes |
| 51–52 interaction | Candidate returned through API adapter; ValidateStoreAndHandoff applies to same campaign/brief/version | `briefMatches`, immutable review fingerprint and matching shared-context snapshot |
| 55–56 state machine | Editing invalidates current storage/acceptance; pause retains work; no extra BriefStatus | Fingerprint binds candidate, semantic audit, findings, evidence and advice; existing pause/cancel/recovery preserved |
| 58–61 package/deployment | Shared runtime, authenticated API, durable worker/checkpoint; inline alternative | No new architecture; both inline and durable checkpoint paths store the report with authoritative campaign state |
| Other AHR chapters throughout | Separate draft submission, compliance, final approval, publication and feedback boundaries | No downstream advertising approval or publication behaviour added by TA-05 |

## Contracts and execution

- `brief-contracts.ts`: candidate structure, semantic review, structured report and
  named budgets. Every section and each selected channel is required structurally;
  unavailable sections require an explicit reason. A complete review additionally
  needs supported findings and grounded themes/visuals.
- `brief.ts`: validate identifiers, exact verbatim support, accepted same-run
  evidence, category fit, complete priority/rationale entries, proposal bases and
  independent semantic checks. Facts are rendered from TA-04's immutable claims;
  the writer cannot substitute a new factual sentence behind a valid citation.
- `agents/trend-brief.ts`: typed LangChain/MeteredChatModel path using stored model
  settings and the team's existing transport/billing. No extra provider SDK or
  evidence-generation service. Two generation attempts at most; semantic failures
  also consume that allowance. Failed/missing replies never fabricate a report.
- `request-budget.ts`: persistent shared collection/quality/synthesis/repair
  allowance: 16 model requests and 160,000 actual tokens per campaign run, with a
  conservative request-byte/output reservation. Synthesis additionally has six
  requests per run, four per attempt, 60,000 request bytes, 6,500 output tokens and
  a 120-second stage limit. These are engineering ceilings, not school rules.
  Existing campaign spend caps, credit holds, provider timeouts and explicit
  founder pause remain authoritative. No checkpoint can be claimed after a crash
  before persistence; existing interrupted-job handling remains conservative.
- `runtime/trend-quality.ts`: orchestrate synthesis after quality assessment,
  retain versions and failed results, update the creative-facing directions only
  from validated proposals, and prevent report failure from entering handoff.
- Browser snapshots cannot replace canonical research state or reset its budgets.
  Stored reports bind the exact candidate/audit, reviewed facts and source ledger;
  even text-only edits invalidate the earlier support review for handoff.
- Current price, historical release vintage and legitimate zero remain distinct.
  Search interest is not sales; holidays are not evidence of cultural preferences;
  weather is not observed demand; price summaries are not purchasing preferences.

## UI

Global Trends is the campaign report library, with explicit Complete/Partial/
Recovery states, version and cited-source count, research request links and a
separate failed-report recovery list. Optional source configuration stays below.

Campaign > Trends starts with the structured report and a table of contents.
All research/report subjects remain directly visible. Findings show priority,
confidence, rationale and expandable original quotations/date/source links.
Reasoned inferences, recommended themes and visual directions are explicitly
separate. Limitations and accepted prior advice retain their provenance. Existing
research requests remain distinct from advertising approval.

## Validation

- `npm run test:trend-brief`: synthetic structural/semantic/budget/recovery,
  source/decision provenance, exact-version storage and durable checkpoint tests.
- Existing TA-04 quality, TA-03 research/evidence, graph, bench, workflow and agent
  suites, TypeScript, targeted ESLint and production webpack build.
- Real example: `scripts/trend-brief-live.ts`, actual ABS current and historical
  original pages plus the real team model writer/auditor; test campaign scope.
  Release headings and exact statistics were manually inspected by Codex (an AI
  reviewer). Detailed source/model transcripts stay ignored locally. The
  sanitised results and review provenance are in `TA-05-ACCEPTANCE-SUMMARY.json`.
- The real example deliberately provides only macro current/historical evidence:
  both citations are supported, other sections disclose missing coverage, the
  structured partial report validates, and handoff remains blocked. This is not
  evidence that all eight real research areas are sufficiently covered.
- Positive complete-report tests and the complete local preview are explicitly
  SYNTHETIC. A separate partial preview uses the actual ABS/model result.
- Actual human support checks by Danting remain pending. Codex inspection and the
  model support audit are not labelled as human sign-off. This does not introduce
  a new mandatory per-campaign approval gate; it is a TA-05 acceptance review task.

## Source-support review prepared for Danting

| Finding | Original | Checks performed by Codex | Human review |
|---|---|---|---|
| August 2026 aggregate household spending, 0.0% monthly | ABS MHSI latest release retrieved 24 October 2026, released 29 September 2026 | Exact month/percentage, nominal current-price basis, seasonal adjustment; not SKU demand or web performance. The page's total-spending table has a different period heading, so the claim is confined to the clearly labelled Key statistics statement. | Pending |
| April 2025 aggregate household spending, 0.1% monthly | ABS MHSI April 2025 release, released 5 June 2025 | Historical release vintage explicitly identified; no assumption of unchanged revisions, current sales or campaign uplift. | Pending |

Originals: [ABS latest release](https://www.abs.gov.au/statistics/economy/finance/monthly-household-spending-indicator/latest-release),
[ABS April 2025 release](https://www.abs.gov.au/statistics/economy/finance/monthly-household-spending-indicator/apr-2025).

Work remains on local `codex/ta05-evidence-backed-brief` for review. This document
neither updates Jira status nor claims a merge or GitHub publication.

### Final local verification — 24 October 2026

14 TA-05 synthetic acceptance groups passed. Existing quality 15, research 15,
evidence 11, graph 2, bench 15, workflow 15 and agent 9 groups passed.
TypeScript and targeted ESLint passed. The actual normal example passed eight
checks; the actual model adversarial-source example passed ten, including
rejection of source instructions changing country, evidence, completion or tools.
Model cost estimates were US$0.00121 and US$0.00117 respectively. Both retained
INCOMPLETE for deliberately missing categories; source-supported partial reports
passed structural and semantic validation. Human acceptance remains pending.

Desktop and 390px review found all sections/channel headings present and no
horizontal page overflow. Original quotations and all seven scope rationales
expand in place; global Trends links to each campaign report and requests.

The inline engine loads neighbouring campaigns and prior advice from platform
storage. Browser workspace saves cannot create or overwrite performance reports
or acceptance records. Report support fingerprints also bind internal-data consent
and upload identity; an affected handoff returns to revalidation. Negative final
semantic checks withdraw support and open the existing clarification workflow,
while preserving the rejected original claim and source.

The final adversarial test places the synthetic instruction at the start of the
actual 1,800-character model excerpt and asserts its inclusion. A prior suffix
probe was truncated before transmission and is not counted as attack validation.
The effective probe passed all ten checks, including the actual-input inclusion
check.
