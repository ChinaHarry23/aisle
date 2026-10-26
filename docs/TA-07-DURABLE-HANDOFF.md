# TA-07 — durable TrendBrief persistence and AHR-03 handoff

Local implementation, 26 October 2026. Base: refreshed origin/main
`7d00b61c9e46f59053b0bfd641c41919ccc72ed4`, with the local TA-06 ranking changes.
TA-06 and TA-07 are delivered together on `codex/ta06-ta07-ranking-handoff`,
under the user's 26 October push authorisation. Main merge and deployment are
not part of that delivery.

## Requirement and Stage 1 mapping

SCRUM-42 requires a saved, validated, versioned report before orchestrated AHR-03
handoff. Stage 1 UC-02 step 13 stores the brief/evidence/limitations; extension
13.a retains a recoverable draft and retries storage, with no handoff. Step 15
hands the stored brief to Content Generation; extension 15.a retains the complete
report and retries delivery without repeating research. The Trend Analyser never
calls a content worker directly. The shared operation graph owns the transition.

Main also permits product-led creative continuation with evidence gaps. This is
explicitly a `limited_product_direction`, with an INCOMPLETE research report,
not a successful COMPLETE research handoff. It must still have a valid current
strategy/report, durable save and receipt. `validated_research` requires COMPLETE
quality and report validation. Neither mode approves publication, expands scope,
or turns unsupported findings into facts. Existing main's human compliance gate
is preserved. Full UC-02 success remains restricted to sufficiently supported work.

## Durable contract and ownership

- `StructuredTrendBrief` retains campaign/run/brief IDs, context revision, report
  and quality versions, strategy version, exact source IDs/excerpts, source dates,
  limitations and prior confirmed advice. Campaign review/decision histories are
  retained alongside it.
- `TrendDelivery` is a typed outbox/inbox record within the same campaign aggregate.
  Its key binds campaign, run, context, report version and report fingerprint. It
  records readiness mode, stable AHR-03 job ID, PENDING / ACKNOWLEDGED / FAILED,
  attempts, errors and timestamps. `persistedState` records the committed state.
- Exact snapshot matching covers the report, reviewed assessment, decisions,
  strategy and active data consent. Source, scope, run, version and consent changes
  invalidate dispatch. Report completion is independent of job/receipt completion.
- AHR-03 receives the actual saved format through the existing graph and copy
  adapter. Its prompt includes the accepted report reference and continuation
  mode; generated creatives retain the brief/run/context/job reference.
- Storage remains the platform SQL KV (SQLite/Postgres), workflow SQLite and the
  existing LangGraph orchestration. No new SaaS, market tools, model or secret.
  Internal shared contracts live in `delivery.ts`; no separate downstream service
  or owner approval is assumed. Future remote consumers must retain the same
  stable key and ACK semantics.

## Save and handoff barriers

1. Quality/report preparation stops at `trend.handoff` for a durable save.
2. The orchestrator stages a PENDING delivery and stops at `creative.receive` for
   its durable save. Unsaved or mismatched records cannot be accepted.
3. The AHR-03 handler validates and acknowledges that exact stored delivery. It
   stops at `creative.generate`; the ACK must be durably committed before any copy
   or media call. ACK means job acceptance, not generated content or publication.
4. Generation atomically claims the job in a tenant-scoped SQL inbox. Concurrent
   requests/processes and repeated acknowledgements reuse the stable job. A saved
   completed result is reused rather than generated again.

`afterStage` enforces these barriers even for multi-step ADVANCE requests.
The durable worker checkpoints after each stage. Inline and Studio use the same
canonical persistence helper. Workflow checkpoint transactions save report,
receipt, job continuation and revision together; canonical revision and lease
checks reject stale work. Inline/Studio use compare-and-set on the exact base
campaign, preserving other campaigns and refusing newer/cancelled/archived state.

## Failure and recovery

- Inline/Studio write a SQL recovery journal before the canonical save. If the
  canonical save fails, the current result survives as PENDING; the next resume
  retries that exact write, without calling research/model/media again. A crash
  after commit is recognised from the committed aggregate. Superseded drafts are
  retained but cannot overwrite newer state. The authenticated recovery endpoint
  exposes only status in the owner's namespace.
- Workflow writes a recovery checkpoint outside its canonical transaction. A
  failed canonical transaction leaves that draft intact. Explicit job retry first
  restores the checkpoint before advancing; paid research is not repeated.
- An unavailable/throwing AHR-03 acceptance check records FAILED delivery, pauses,
  notifies the founder and leaves the COMPLETE saved report unchanged. Resume
  retries the same delivery/job. It does not run research again.
- A durable inbox claim prevents double starts across hosts/processes. If a
  process dies after starting an external generation call but before retaining
  its result, the call's outcome is uncertain. The system pauses for result/provider
  reconciliation instead of automatically charging again. It does not pretend
  that a database receipt guarantees exactly-once effects inside a third-party
  provider. Research/accepted report remain intact; an existing recovery draft
  always takes precedence over starting work again.
- If the entire storage backend rejects every write, no system can promise a
  durable new draft on that backend. The route reports failure and does not
  dispatch. A successful canonical commit is never reported before it occurs.

## Founder UI

`DeliveryStatus` separates Research, Storage and Handoff, with report version,
partial/complete labels, paused/failure/pending/accepted states, recovery-draft
notice, retry actions and tracking/history. Acceptance is explicitly distinct
from creative completion. Existing research details retain coverage, dated
sources, qualitative confidence, limitations and clarification/decision history.
The fixture preview is paused and prominently SYNTHETIC, not a live run.

## Reproducible acceptance

Run `npm run test:trend-delivery` (synthetic offline fixtures; no external calls).
Ten acceptance groups cover:

1. Save-before-send, durable ACK-before-model, actual AHR-03 request and generated
   output references; completed duplicate delivery reuses saved creatives.
2. Downstream outage/throw and recovery; duplicate ACK retains one job and no model
   or research calls during the delivery retry.
3. Stale context/run/report, changed consent, tampering and cancelled permission.
4. Partial validated product direction remains INCOMPLETE; invalid draft blocked.
5. Inline canonical write failure and step-13 recovery without regeneration.
6. Late recovery cannot overwrite cancellation/newer state.
7. Crash after canonical save but before journal confirmation.
8. Actual SQLite trigger abort, database reopen, checkpoint recovery and saved ACK.
9. Independent workflow database connections and reopen cannot start one job twice;
   tenants remain isolated.
10. Actual SQL KV concurrent inbox claims allow one start per owner/report.

Regression: workflow service/independent workers, operation graph, Studio, trust
boundary, TA-04 quality, TA-05 brief/strategy/report/creative, TA-06 ranking,
SCRUM-124 reliability and campaign bench. Also TypeScript, ESLint, production
webpack build, diff checks and desktop/mobile UI inspection. Exact results are
recorded in `TA-07-ACCEPTANCE-SUMMARY.json` after verification.

UI fixture setup: `node --import ./scripts/service-loader.mjs
--experimental-strip-types scripts/trend-handoff-preview.ts`. Writes only paused
SYNTHETIC campaigns in the local dev-alex desk and preserves other campaigns.
