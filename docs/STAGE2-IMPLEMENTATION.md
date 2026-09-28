# Aisle — Stage 1 to Stage 2 traceability

This document maps every requirement in the Stage 1 report (AHR-01 … AHR-06, their
use cases and extension scenarios) onto the code that implements it and the test
that proves it. It is the artefact an examiner can follow from "the report says X"
to "here is where X happens and here is the evidence it happens".

Run everything with:

```bash
npm run bench       # 11 scenario groups over the real engine, no browser needed
npm run auth        # 10 scenario groups over accounts and storage
npm run typecheck
npm run lint
npm run build
```

`npm run bench` is the primary proof. It drives the real `runEngine` through each
use case and asserts the behaviour the report promises, including the extension
scenarios that only fire on failure.

---

## Where the requirements live in the code

| Stage 1 item | Implementation | Proof |
|---|---|---|
| AHR-01 Context Entry | `src/lib/runtime/intake.ts` (validation), `engine.ts` `START` / `PAUSE` | suite: *invalid brief refused*, *missing brand settings block launch* |
| AHR-02 Trend Analysis | `src/lib/runtime/tools.ts`, `steps.ts` `runTrendResearch`, `decide.ts` `decideTrendBrief` | suite: *sourced brief with labelled assumptions*, *unauthorised internal data excluded* |
| AHR-03 Content Generation | `steps.ts` `runCreativeGeneration`, `buildCreatives`, `decide.ts` `decideCopy` | suite: *revise then pass, versions and digests retained* |
| AHR-04 Compliance | `steps.ts` `runComplianceReview`, `deterministicReview`, `decide.ts` `decideCompliance` | suite: *revise then pass* and *three attempts then Manual Review Required* |
| AHR-05 Distribution | `steps.ts` `runMediaAdaptation`, `detectScheduleConflicts`, `runSchedule` | suite: *per-channel versions with frozen claims* |
| AHR-06 Feedback | `steps.ts` `collectChannelResults`, `buildPerformanceReport`, `deterministicRecommendation`, `runFeedbackCollection` | suite: *published, collected, gaps marked, decision stored*, *silent channels marked*, *only accepted notes travel forward* |
| UC-01 step 13 / ext 13.a (agent limits) | `src/lib/runtime/guard.ts` | suite: *five agent attempts refused and logged* |
| Runtime persistence and audit | `src/app/api/engine/route.ts`, `src/lib/runtime/client.ts`, `src/lib/store.ts` | HTTP smoke test; `campaign.log`, `policyDecisions`, `runSteps`, `toolCalls` |
| Accounts, sessions, workspace documents | `src/lib/db/*`, `src/lib/auth/users.ts`, `src/lib/auth/kv.ts` | `npm run auth` |

---

## AHR-01 — Context Entry

**Requirement.** The founder supplies product, audience, objective, budget,
channels, dates and country. The system creates a shared context from that plus
stored brand and country-law settings, hands it to the Trend Analyser, and lets
the founder pause. Nothing may be launched on an invalid brief. Agents may
research, draft and check but may not publish, overspend, change scope or send a
print piece live.

| Clause | Implementation |
|---|---|
| Step 4 — required fields present and usable | `validateIntake()` in `intake.ts` checks strings, budget > 0, at least one recognised channel, recognised country, `endDate >= startDate`, window ≤ 365 days |
| Step 5 — brand and country-law settings exist | Same function: retailer name, non-empty banned-terms list, and a stored rule set for the campaign's country |
| Ext 3.a / 4.a / 5.a — refuse and explain | `startIntake()` writes the problems to `campaign.validationProblems`, logs each with its clause, keeps status `draft`, and returns "The pipeline did not start." |
| Step 6 / 13 — no invention, scope frozen | Every later step reads `campaign.sharedContext`; agents never write product, audience, budget, country or channel |
| Step 10.a — one bench per campaign | `START` refuses when the campaign is not `draft`/`paused` and leaves the existing run untouched |
| Step 11 — visible progress and pause | `AgentRun` (`status`, `step`, `stepsTaken`), `runSteps` trace, `PAUSE` command |
| Ext 13.a — block and record | `guard.ts` rules, surfaced on the **Runtime** tab's boundary-check panel |

The publish rule is deliberately two-layered: the bench stops at `scheduled`
because no agent step can publish, and if a publish is attempted through the guard
anyway, `AHR-01-R13.publish` refuses it — with a stricter branch when the campaign
includes print, because a catalogue cover is always a founder decision.

**Try it:** open a campaign → **Runtime** tab → *Boundary check*. Each button
frames an out-of-bounds agent action, the guard refuses it, and the refusal appears
in **Policy decisions** and in the campaign log.

## AHR-02 — Trend Analysis

**Requirement.** Work within the brief, use only authorised information, record
the source and date of supporting information, separate supported findings from
assumptions, report what could not be established, and hand a completed brief on.

The analyser is given four tools (`tools.ts`) and must ground its brief in what
they return:

| Tool | Kind | What it does |
|---|---|---|
| `retail.internal_signals` | internal retail | POS velocity and catalogue history. Refused when the retailer has not authorised internal data |
| `web.market_context` | external public | Wikipedia REST summary; records the page URL and revision date |
| `web.competitor_scan` | external public | DuckDuckGo instant answers; counts superlative framing in market |
| `web.season_weather` | external public | Open-Meteo forecast for the campaign country and window |

Every call becomes a `ToolCall`, and each returns zero or more `Evidence` rows
carrying `sourceName`, `sourceRef`, `observedAt`, `fetchedAt`, `status`
(`verified` / `assumed` / `conflicting` / `stale` / `unavailable`) and a confidence
figure. Findings link to evidence by id; a finding with no citable evidence is
stored as `basis: "assumption"` and labelled as such in the UI.

The tools report honestly when they fail: an unreachable source produces an
`unavailable` evidence row and a `TrendBriefGap`, never an invented result. That is
what makes the brief trustworthy when the network is blocked — the tab says
"public reference unavailable" instead of quietly making something up.

| Clause | Implementation |
|---|---|
| Step 5 — record source and date | `Evidence.observedAt` / `sourceRef`; rendered in the Evidence ledger table |
| Step 7 — supported vs assumption | `TrendFinding.basis`, `TrendFinding.evidenceIds` |
| Step 11 — brief with sources, confidence, limitations | `campaign.brief`, `trendFindings`, `trendGaps` |
| Ext 4.b — internal data unauthorised | tool returns `skipped`, a gap of kind `unauthorised`, and a guard record via `AHR-02-R.privacy` |
| Ext 4.a / 5.a / 12.a — source unavailable, outdated, low confidence | gaps of kind `missing_source`, `outdated`, `low_confidence`, each with the effect on the analysis |

## AHR-03 — Content Generation

**Requirement.** Produce a draft from the brief and brand assets; submit it to
compliance before anything else; log each draft with its inputs and creation date;
revise on rejection; escalate after three failed cycles.

- `runCreativeGeneration()` calls the copy decision (`decideCopy`) with the brief,
  the allowed and banned terms, and — on revisions — the previous compliance
  corrections. It falls back to deterministic copy whenever no model is wired, so
  the loop is demonstrable with a fresh clone.
- Every version is generated as two variants (A/B) with poster renderings, and the
  draft is explicitly marked *unpublished, not sent to any distribution channel*.
- Version numbering is the audit spine: v1 is written to carry unsupported claims
  so the revision loop is visible, v2+ are clean. `creativeVersion` on each
  `ComplianceAttempt` records what was reviewed.
- The spend for image generation is checked by the guard (`SPEND_MEDIA`) before it
  is booked, and counted into `campaign.spend`.

## AHR-04 — Compliance

**Requirement.** Review text, claims, conditions, audience and platform policy
against country law and brand rules; record each issue with severity, affected
content and the rule; separate confirmed violations from items needing human
judgement; allow up to three review/revision cycles; then either *Awaiting Human
Approval* or *Manual Review Required*; never approve its own work.

`runComplianceReview()` merges two reviews:

1. **Deterministic** (`deterministicReview`) — brand banned terms are always
   confirmed breaches; print condition lines, high-spend reach and Instagram
   caption truncation are raised as `human_judgement` items with the policy source
   and date.
2. **Model** (`decideCompliance`) — when a backend is configured, the model reviews
   the same copy and its issues are merged in. The deterministic issues always
   survive, so a model cannot clear a banned term.

The merged outcome drives the state machine:

| Outcome | Next state |
|---|---|
| `changes_required` and attempts < 3 | status `revising`, run → `creative.revise` |
| third attempt still failing | status `awaiting_approval`, run → `founder.gate`, logged as **Manual Review Required** |
| `pass` | status `awaiting_approval`, run → `founder.gate` |

Each submission stores a `ComplianceAttempt` with the attempt number, reviewed
version, an input digest (`inputDigest` + `digestHash`), the model used, the issue
list, and the policy references — so the whole revision trail is reconstructible.

Approval is founder-only. `AHR-04-R12.approve-own-work` refuses any agent that
tries to approve, and the legacy `founderDecision` record is kept alongside the new
policy log.

## AHR-05 — Distribution

**Requirement.** Adapt an approved master per selected channel without changing
cleared claims or imagery; propose times from campaign dates, audience behaviour
and prior recommendations; flag scheduling conflicts instead of resolving them;
track Adapted → Scheduled → Published; never skip an item silently; never publish
outside the founder's channels, dates or budget.

- `runMediaAdaptation()` builds a `ChannelVersion` per channel, each carrying the
  frozen `approvedClaims` and a `claimsUnchanged` flag.
- **Claims are frozen at approval.** `deriveClearedClaims()` records the wording
  that actually made it into the approved copy; a channel body that would drop or
  add a product claim is *not produced* — the guard rule `AHR-05-R.claims-frozen`
  refuses it, the item is marked `failed`, and the founder is asked. Nothing is
  rewritten and nothing is skipped quietly (`AHR-05-R.no-silent-skip`).
- `detectScheduleConflicts()` flags same-channel clashes within 24 hours, slots
  outside the founder's window, and frequency issues, with the other campaign
  named. Each conflict is stored unresolved and surfaced on **Schedule** and
  **Approvals**; `RESOLVE_CONFLICT` records the founder's decision.
- The bench stops at `scheduled`. Publishing is a separate founder command, and the
  guard is consulted again at that moment.

## AHR-06 — Feedback

**Requirement.** Collect results only from channels that actually ran and only
where authorised; never invent figures; mark late, incomplete or unauthorised
channels as gaps; summarise what ran; recommend what to keep, drop or change with
the evidence behind each point; let the founder accept, edit or discard; attach an
accepted note to the next brief without rewriting it; never auto-publish or change
spend.

- `collectChannelResults()` is a declared adapter: each channel returns its own
  report and can return `not_authorised`, `late`, `incomplete` or `ok`. Silent
  channels are recorded with the reason and excluded from totals — they are never
  filled in.
- `buildPerformanceReport()` totals only reporting channels, lists the gaps in the
  summary, and sets `recommendationUnsupported` when there is nothing to reason
  from. In that case `decideRecommendation` produces **no advice** rather than
  generic filler.
- `decideRecommendation` prefers the model and falls back to
  `deterministicRecommendation`, which derives keep/change points from the
  collected CTR spread and the recorded gaps.
- `DECIDE_RECOMMENDATION` stores `accepted` / `edited` / `discarded` with the
  author and time. `attachableRecommendation()` is the *only* path that attaches a
  note to a new brief, and it skips discarded ones — UC-06 ext 10.a.

## Runtime, storage and the human-in-the-loop boundary

```
browser (Zustand)                server (Next.js route)
  │  campaign + command +  ────►  runEngine(ctx, campaign, command, settings, brand)
  │  workspace snapshot            │
  │                                ├── guard.ts       allow / block, recorded
  │                                ├── tools.ts       real HTTP, recorded
  │                                ├── decide.ts      LLM decision or deterministic
  │                                └── steps.ts       one unit of agent work
  ◄──── updated campaign, events, run steps, policy decisions ────┘
  │
  └── persisted through /api/workspace into SQL, plus localStorage
```

The engine runs on the server, so the LLM keys, the outbound HTTP tools and the
policy layer stay off the client, and a run can continue while the tab is closed.
The client's `pump()` loop only decides *when* to ask for more work; each `ADVANCE`
is bounded server-side, so the loop cannot spin.

The engine is a pure function of `(workspace, campaign, command)`. That is what
makes `npm run bench` possible: the same code path the browser exercises is
driven directly in Node, with a stub model and a stub poster renderer, in about a
second.

### "Advanced technologies" (Stage 2 criterion 4)

| Technology | Where |
|---|---|
| LLM agents with structured, decision-shaped output | `decide.ts` — four narrow JSON decisions, each validated and clamped |
| Tool use against live public data | `tools.ts` — Open-Meteo, Wikipedia, DuckDuckGo, with timeouts and honest failure |
| Policy enforcement as a first-class layer | `guard.ts` — seven policy rules, each citing its requirement clause, every evaluation logged |
| Deterministic fallback so the demo never depends on a key | every decision has a rule-based path, and the run trace records which was used |
| Evidence ledger with provenance and freshness | `Evidence`, `TrendFinding.basis`, `TrendBriefGap` |
| Server-side orchestration with a bounded, resumable state machine | `runEngine`, `AgentRun.step`, `setRun` |
| Optimistic-free single-writer workspace document | whole-document round trip through `/api/engine` |

## Storage

Accounts and workspaces are SQL rows, behind one small interface
(`src/lib/db/types.ts`) with two adapters:

| Backend | When | Why |
|---|---|---|
| SQLite (`node:sqlite`) | development, and any single-machine install | Node ships the driver, so a fresh clone has a working database with nothing installed and no credential to hold |
| Postgres (`pg`) | deployments, when `DATABASE_URL` or `AISLE_DB=postgres` is set | a serverless filesystem is ephemeral, so accounts need a hosted database |

`src/lib/db/index.ts` chooses, opens once per process, and migrates with idempotent
`create table if not exists` statements, so there is no migration step to run by
hand. Uniqueness of an email address is a database constraint (`users.email
unique`), not a read-then-write check — two simultaneous signups cannot create two
accounts.

The failure path is part of the design. An unusable backend throws
`DatabaseUnavailableError`, which the auth routes turn into a 503 with a sentence a
user can act on, while the driver detail goes to the server log. This is the direct
fix for a real defect: the previous build stored accounts in Vercel Blob and put the
raw blob error on the signup form, so a revoked token read as
"Vercel Blob: Failed to fetch blob: 403 Forbidden" to someone who only wanted an
account — and there was no account to create.

## What is simulated, and how it is labelled

Honesty about this is part of the design, not an omission:

- **POS, catalogue history and basket data** are a deterministic model of the
  retailer's own data source (`internal_retail`, `internal://…` refs).
- **Channel performance** comes from a declared adapter that models each channel's
  report. There is no live Meta/Google/print API in the prototype, and the
  collector says so per channel.
- **Channel attention windows** are documented assumptions, labelled
  `assumption://channel-behaviour/…` and stored as `assumed` evidence.
- **Model calls** fall back to deterministic rules when no key is present; every
  decision trace records `live_model` or `deterministic_fallback`.

## Known limitations

- The workspace document is stored as one JSON row per user; there is no
  field-level concurrency control, so two tabs editing the same campaign can
  overwrite each other.
- `/api/workspace` save failures are not surfaced in the UI (the engine route
  degrades gracefully by using the client's copy).
- The Postgres adapter is written against the same interface as SQLite but has not
  been exercised against a live Postgres instance, because no hosted database was
  configured in the development environment. `npm run auth` covers the SQLite path
  and the shared SQL.
- Scheduling conflicts are detected against the stored schedule, not against a real
  channel calendar.
- The escalation path in AHR-04 is reachable with a model that repeatedly produces
  non-compliant copy; the deterministic path reaches it through the generic
  editorial motif.
