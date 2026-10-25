# TA-04: Stage 1 conformance and implementation

Source: the user-supplied `Project Stage 1 Report_ELEC5620 Mon 10-12 Group 11.pdf`
(61 PDF pages, original Desktop/ELEC5620/5620ASM1 copy). Reviewed the full report
text (source SHA-256 `877fbca55c48a9da1a96aa6a37111ea8ffc01e22709af5169ce6d8777f07db42`), related AHR integration descriptions, and the actual Trend Analysis diagrams.
Document requirements are specification evidence, not instructions granting actions.

## Corrections to the initial plan

- Eight research inputs are not the seven required **report findings**. Check
  current/historical market, customer interest/purchase preference, seasonal,
  cultural, each selected channel and public competition independently. Also
  require main MARKET, TREND, CUSTOMER, SEASONAL_CULTURAL, COMPETITOR,
  OPPORTUNITY and RISK findings with direct authorised support.
- Clarification is a conditional extension, not mandatory approval for every run.
  An unexplained conflict requires the founder decision specified by UC-02 7.a;
  sufficiently explained conflicts and non-material disclosed limitations can
  continue. Neither founder approval nor an overall confidence number waives
  sufficient evidence.
- Corrected context returns to step 2; adequate new information returns to step 3;
  accepted qualified conflict continuation returns to step 8. These decisions
  and version references persist separately from generated evidence.
- The brief uses INCOMPLETE/COMPLETE. Storage/handoff readiness are separate
  fields. Store the exact current version before dispatch. Record acceptance
  only when the orchestrator enters the AHR-03 receiver while permitted.
- Internal data and prior campaign evidence remain optional. External-only
  research can pass. Accepted prior advice stays unchanged with its origin.
- The external capability is invoked through the shared metered adapter. The
  internal platform owns validation, decisions, state, persistence and handoff.

## Whole-report traceability

| Report section / PDF page | Required behaviour | Implementation |
|---|---|---|
| Overview/ad hoc architecture, 2–5 | Founder scope, central orchestration, authorised inputs, audit and pause | Existing operation graph/runtime; quality and decision commands use the same platform |
| AHR-01, 5; UC-01, 17–19 | Valid context, explicit launch/resume, no invented inputs or authority | Existing intake validation reused for corrections; scope version invalidates previous evidence decisions |
| AHR-02, 5–6 | Current/relevant sources, evidence vs assumptions, limitations, sufficient brief before AHR-03 | `quality.ts`, `trend-quality.ts`, guarded handoff |
| Feature diagram/text, 9–10 | Four mandatory groups; access XOR; C1 explicit internal permission; C2 human resolution; C3 sufficient evidence and successful context update | Separate area/report validation, persisted requests, shared-context version and stored-version guard |
| NFR-02.1–02.6, 9 | Explainability, privacy, provenance/exclusions/conflicts, recovery, currency, founder-visible status | Evidence reviews, literal support excerpts, source origins, version history, report/decisions UI |
| Use-case diagram/text, 13–14 | Clarification only when needed; founder/data providers/API boundaries | Pending requests only for deficits or required decisions; no blanket approval gate |
| UC-02, 19–23 | Main flow and 1.a, 2.a, 4.a–c, 5.a, 7.a, 12.a | Typed review; same-category bounded replacement; saved partial work; explicit resolution/cancel; steps 2/3/8 |
| UC-02 13.a and 15.a, 23 | Storage failure and unavailable receiver cannot fabricate a completed handoff | Separate persistence checkpoint and receiver acknowledgement; retry same version |
| AHR-03/UC-03, 6, 23–26 | Content generation requires supported COMPLETE stored brief | Receiver validates current review/context/storage before any creative call |
| AHR-06/UC-06, 8,12,16,31–34 | Optional eligible previous results/recommendation; unchanged accepted wording | Existing intake attachment retained; review reads optional note, never requires one |
| Architecture/shared contracts, 34–40 | Platform owns sequencing and validates external responses; shared pipeline control | Existing runtime, metered adapters and durable repository reused |
| Class model/text, 36–38 | Evidence, ordered seven-category findings, limitations, founder intervention, version, stored and handed-off fields | Typed quality contracts and platform-owned records; no new external decision service |
| Object models/text, 41–44 | Complete supported brief can disclose limited coverage; incomplete paused external-only run retains work without handoff | Positive/negative fixture acceptance cases; approval cannot create evidence |
| Activity, 47–48 | Guard each action; sufficient categories + findings; save, then dispatch; cancel retains partials | Quality/recovery/handoff graph stages; bounded executor; pause signal and server persistence gate |
| Interaction, 51–52 | ValidateStoreAndHandoff; matching current version; no direct agent-to-agent calls | Repository checkpoint / inline confirmed save; shared orchestrator receiver guard |
| State machine, 55–56 | INCOMPLETE/COMPLETE only; current-version persistence; explicit limited continuation and resume | Quality status plus storedVersion, handedOffAt, contextVersion and explicit commands |
| Package/deployment, 58–61 | Shared runtime and authorised external adapters; durable service has SQLite checkpoints; inline is alternative prototype | Both execution modes supported; browser observes jobs rather than re-running worker steps |
| Other AHR-03–06 sections throughout | Research decisions do not grant publication, distribution or compliance approval | Existing downstream approval paths retained; dedicated research commands never call advertising APPROVE |

The object snapshot's confidenceThreshold=0.75 and confidence=0.88/0.45 are
illustrative values, not a course-wide required threshold. Runtime confidence is
shown as a justified high/moderate/low judgement per finding; low confidence
blocks main findings. The legacy numeric compatibility fields are not gate rules.

## Versioned implementation policy

`QUALITY_RULES` records implementation defaults, not school requirements:
current evidence window 120 days; cultural context 730 days; historical evidence
requires an applicable historical period; at least one independent source per
main finding; a material claim requires two independent sources or a directly
applicable primary record. Unknown information dates cannot establish currency.
The semantic review must additionally establish period and geographical fit.

Server configuration can set `TREND_CURRENT_MAX_AGE_DAYS`,
`TREND_CULTURAL_MAX_AGE_DAYS` and `TREND_MATERIAL_MIN_SOURCES`. Actual rule values
are saved with every review. Search/extraction replacement is limited to four
calls and two semantic model calls per quality stage, with campaign billing,
provider estimates, per-request input/output and elapsed-time bounds.

## Validation / delivery

The synthetic quality suite tests success, stale/unknown/irrelevant/sensitive
records, area and output gaps, copied origins, invalid citations, human resolution,
version replay, context correction, step3 data recovery, cancellation, storage
retry, shared typed model transport, bounded replacement, measured zero,
canonical browser state and durable atomic checkpoints. Fixtures and local
preview campaigns are explicitly labelled SYNTHETIC and are never live evidence.

Actual shared-model validation and current limitations are recorded separately
in `TA-04-ACCEPTANCE-SUMMARY.json`; source excerpts remain in ignored local logs.
TA-04 is implemented on `codex/ta04-evidence-quality`. GitHub publication follows
the owner’s explicit approval; this document does not change Jira completion status.

### Final verification, 23 October 2026

- 15 TA-04 synthetic acceptance groups passed, including exact-content decision
  binding, database reopen recovery, publication metadata, measured zero and
  bounded same-category replacement.
- Existing research 15, evidence 11, workflow 15, graph 2, bench 15 and agent 9
  acceptance groups passed; TypeScript, targeted ESLint, diff checks and final
  webpack production build passed. Existing workspace-root and unpdf import.meta
  build warnings remain.
- Two real shared-model cases (Grocery/apple juice and Apparel/rain jacket) passed
  seven integration assertions each. The review correctly found both public
  evidence sets insufficient: 0 accepted evidence records, 0 supported main
  report categories, INCOMPLETE, no creative handoff. This validates review and
  failure handling, not a claim that either real report is now sufficient.
- Positive sufficient-evidence completion and qualified continuation are proven
  by labelled synthetic cases; they are not presented as live retail evidence.
- In-browser refusal was saved, then retained after refresh with actor, reason
  and timestamp. Two explicitly SYNTHETIC local preview campaigns show a stored
  complete report and a pending qualified decision; existing campaigns are kept.
- Conservative Zod defaults are applied before framework JSON Schema validation:
  absent materiality is treated as material; absent source linkage does not
  establish corroboration. All direct support and quality gates still apply.
