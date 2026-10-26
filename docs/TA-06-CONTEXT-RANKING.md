# TA-06: context-aware priorities and campaign recommendations

Implementation base: latest GitHub main `7d00b61` (26 October 2026), after the
previous PRs were merged. TA-06 and TA-07 are delivered together on `codex/ta06-ta07-ranking-handoff`.

## Scope and Stage 1 alignment

AHR-02 (report pages 5–6), the feature model (9–10), UC-02 steps 8–10 (19–23) and
its structural/behavioural models require context-aware comparison of opportunities
and risks, supporting sources, uncertainty, suitable themes and visuals, and no
change to founder-approved scope. The full Stage 1 mapping already recorded in
`TA-05-STAGE1-CONFORMANCE.md` remains the baseline. There is no school-mandated
numeric scoring threshold. TA-06 defines named team rules, not success probabilities.

The refreshed main already contains campaign strategy synthesis and deterministic
report projection. TA-06 extends those paths rather than reintroducing the older
writer/auditor pipeline or adding model/API calls. Existing labelled product-led
creative continuation on partial evidence is preserved; it does not upgrade
research completeness, claim substantiation or publication permission.

## Ranking method: ta06-1

Local `rankFindings` consumes the current campaign/run reviewed ledger and retained
creative applications. All ten factors are 0–1, multiplied by the following weights:

| Factor | Weight | Calculation |
| --- | ---: | --- |
| Product | 12 | Proportion of distinct meaningful product words in exact reviewed source quotations |
| Audience | 14 | Same conservative word overlap for the target audience |
| Objective | 12 | Same overlap for the approved objective; no claim of effectiveness |
| Timing | 10 | Maximum overlap of explicit source applicability interval with campaign dates; reviewed temporal fit without an interval gets 0.5 |
| Country | 8 | Matching reviewed source geography 1, transferable 0.5, otherwise 0 |
| Selected channels | 10 | Proportion of selected channels explicitly covered by source records; generic context without a named channel gets 0.25 |
| Budget fit | 8 | Resource-planning feasibility against fixed campaign budget tiers; unknown gets 0.25 |
| Evidence quality | 12 | Mean accepted source review: primary 1, credible 0.6, multiplied by 0.75 for a recorded conflict/qualification; excluded records have no contribution |
| Recency | 8 | Information-date age against the fixed review date and configured current-source horizon; accepted historical context gets 0.6, not current status |
| Potential value | 6 | Saved creative-plan judgement: high 1, moderate 0.6, low 0.2, unknown 0.25; not measured uplift |

Budget tiers use the campaign budget's own units: small ≤1000, medium <5000,
large ≥5000. Existing-asset plans get feasibility 1 in every tier; single-asset
plans get 0.5/1/1; multi-asset plans 0/0.5/1. These are documented planning
heuristics, never vendor quotes, spend instructions or a new budget allocation.
Unknown/conflicting effort or value proposals use unknown rather than choosing the
most favourable label. The model explains resource/value judgements in the saved
insight; the platform does all arithmetic and final ordering locally.

Source word overlap is intentionally conservative and fully inspectable. It does
not infer synonyms, causation, population generalisation or implicit consumer
preferences. A zero does not prove irrelevance. This limitation is displayed in
the report; the shared LLM still supplies grounded creative explanations.

Score = sum of weighted factors, rounded to two decimals. Unsupported findings
have no accepted priority score (stored as 0), regardless of model confidence or
value. Sort tiers: supported before assumptions; within supported findings,
material/conflicting risks first; then descending score, source quality and
recency, then stable finding ID. This gives stable ties independent of input order.
Separate opportunity/risk rank lists and an explicit attention queue prevent risks
from being buried. Unsupported risk warnings stay visible without becoming facts.

Reproducibility means identical approved context, reviewed ledger, rules version,
review date and saved creative plan yield identical ranks. It does not promise
that repeated free-form LLM generations choose identical planning judgements.

## Evidence and recommendations

Source IDs and original statements are retained, with counter-evidence IDs,
conflict explanation, qualifications and exclusions. Search interest, aggregate
spending, uploaded retailer units, competitor/catalogue activity, calendar and
weather signals carry distinct interpretation limits. None becomes a sales,
preference, causation or ROI claim merely through ranking.

The shared strategy model receives the initial local ranking and rule meaning,
and returns concise insight implications plus optional effort/value labels.
Each retained finding maps to the strategy's actual theme/application, concept
visuals and selected-channel approaches when available. Material risks without a
specific concept retain an explicit review constraint. Missing mappings are
labelled as unavailable/product-led hypotheses, not invented research recommendations.

The new report view shows priorities, opportunity/risk lists, all factor points,
method/weights, confidence meaning, counter-evidence and theme/visual/channel
implications. High/moderate/low confidence remains qualitative source-review
judgement; no new percentage confidence or calibrated probability is presented.

CampaignStrategy stores the complete versioned ranking. Current-strategy checks
recompute it, including the creative mappings; stale scope/run, rules, source or
planning inputs invalidate reuse. The strategy report projects the same order and
checks the complete saved snapshot. No additional authority, spend or tool access
is introduced.

## Verification and review

`npm run test:trend-ranking -- --record` covers:

- Seven one-dimension paired comparisons (audience, timing, country, channel,
  objective, budget and product), with fixed source data. Each reverses the top
  recommendation and records the exact factor/score change.
- A combined distinct-campaign comparison with an explainable recommendation flip.
- Stable ties, input-order independence, immutable campaign scope and reproducibility.
- Unsupported high-confidence/high-value assumptions versus supported findings;
  absent evidence; material/conflicting risk visibility and opposing records.
- Stale context and explicitly synthetic provenance rejection.
- Active strategy/report order, concrete saved creative/channel mapping, and
  tampered-rank or changed-mapping rejection.

These source/plan fixtures are explicitly SYNTHETIC and never represent measured
campaign performance. Recorded paired deltas are in `TA-06-ACCEPTANCE-SUMMARY.json`.
Existing strategy, report, brief, quality, creative-continuation, SCRUM-124 and
bench suites are regression-checked. No claim of outperforming a fixed baseline
is made; comparative quality/value evaluation remains TA-10.

Risk constraints, including opposing evidence IDs and uncertainty, are forwarded to
the existing creative request even when a risk was not chosen as a strategy insight.
The creative regression checks the actual request contains this constraint context.

## Final verification — 26 October 2026

- 14 TA-06 acceptance groups passed, including a recommendation flip in each
  isolated context dimension and the combined campaign example.
- Strategy 10, strategy-report 6, TA-05 brief 14, quality 17, SCRUM-124 16,
  creative application/constraint checks and bench 22 scenario groups passed.
- TypeScript, full ESLint, diff checks and production webpack build passed.
- Desktop 1280px and narrow 390px browser checks passed. At 390px the document
  width was 390px. Risk/counter-evidence and factor details expand correctly.
- Local preview is explicitly SYNTHETIC, paused, and makes no model or tool calls:
  `http://127.0.0.1:3001/campaigns/cmp_ta06_ranking_fixture?tab=research`.
- UI capture `docs/TA-06-PREVIEW.png` is ignored by Git. TA-06 and TA-07 share
  the user-authorised delivery branch; Jira comments record the published commit.
