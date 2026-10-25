# AHR-01 Context Entry & Shared `CampaignContext` Contract (`CE-00` / `SCRUM-118`)

- **Jira Ticket**: [`SCRUM-118`](https://aisle5620.atlassian.net/browse/SCRUM-118) (`CE-00 — Confirm Context Entry scope and the CampaignContext contract every agent consumes`)
- **Epic**: [`SCRUM-13`](https://aisle5620.atlassian.net/browse/SCRUM-13) (`AHR-01 Context Entry`)
- **Owner**: Xinlong Bao (Harry)
- **Reviewed Downstream Contracts**: [`SCRUM-27`](https://aisle5620.atlassian.net/browse/SCRUM-27) (`TA-01 — AHR-02 Trend Analysis`) · [`SCRUM-99`](https://aisle5620.atlassian.net/browse/SCRUM-99) (`DI-01 — AHR-05 Distribution`)
- **Code Authorities**:
  - `src/lib/runtime/intake.ts` (`validateIntake`, `inputDigest`, `digestHash`, `COUNTRIES`, `CHANNELS`)
  - `src/lib/runtime/engine.ts` (`startIntake`, `runEngine`)
  - `src/lib/runtime/guard.ts` (`evaluateGuard`, `guardRuleCatalogue`)
  - `src/lib/runtime/defaults.ts` (`withRuntimeDefaults`, `defaultSpendCap`)
  - `src/lib/insights.ts` (`extractableInsights`, `applySelectedFeedback`, `acceptSavedInsights`)
  - `src/lib/workflow/commands.ts` (`parseCommand`, `assertTransition`)
  - `services/workflow/repository.ts` (`WorkflowRepository.enqueue`, `workflow_campaigns`, `workflow_jobs`)
  - `src/lib/seed.ts` (`makeContext`, `blankCampaign`, `defaultBrand`)

---

## 1. Scope & Implementation Matrix (AHR-01 / UC-01)

### 1.1 Main Success Scenario (UC-01 Steps 1–14) & Extensions

| UC-01 Step / Extension | Requirement Summary | Status | Implementation in Repository | Automated Proof / Follow-up Ticket |
|---|---|---|---|---|
| **Steps 1–3** | Founder opens intake and enters product, target audience, objective, budget, channels, start/end dates, and country (via form or conversational intake assistant). | **Implemented** | `src/app/campaigns/new/page.tsx`, `src/lib/intake/assistant.ts`, `src/app/api/intake/chat/route.ts` | `npm run test:intake` (`scripts/intake-suite.ts`) |
| **Step 4 & Ext 3.a / 4.a** | Validate required text fields (`>= 3` chars), finite budget (`0 < budget <= 5,000,000`), `>= 1` recognised channel, recognised country (`AU \| NZ \| UK \| US`), and valid date order (`0 <= endDate - startDate <= 365` days). Refuse launch and keep status `"draft"` when invalid. | **Implemented** | `validateIntake()` in `src/lib/runtime/intake.ts:51-160`; `startIntake()` in `src/lib/runtime/engine.ts:181-204` writes `campaign.validationProblems`, sets `run.status = "halted"`, `run.awaiting = "brief_correction"`, and logs the refusal with its clause. | `npm run bench` (*UC-01 ext 4.a — invalid brief refused*); `npm run test:workflow` (*invalid brief halted and corrected*) |
| **Step 5 & Ext 5.a** | Check that authorised brand settings (`retailerName`, non-empty `bannedTerms`) and the applicable country-law profile (`brand.countryRules[country]`) exist before any agent runs. | **Implemented** | `validateIntake()` in `src/lib/runtime/intake.ts:129-157` returns `ValidationProblem` entries citing `UC-01 ext 5.a`. | `npm run bench` (*UC-01 ext 5.a — missing brand/country-law settings block launch*) |
| **Step 6** | Create one shared campaign context from the validated brief and brand settings without inventing product, audience, budget, country, or channels. Apply publication, spend, and human-decision boundaries before any agent starts. | **Implemented** | `makeContext()` and `blankCampaign()` in `src/lib/seed.ts`; `resolveInlineEngine()` in `src/lib/workflow/inline.ts` for inline `/api/engine`; `WorkflowRepository.enqueue()` for service mode. Both discard browser `status`, `log`, `complianceAttempts`, `founderDecision`, `policyDecisions`, `spend`, and `run`. | `npm run test:workflow` |
| **Step 7 & Ext 7.a** | Carry forward only insights the founder saved from an accepted or edited recommendation and then ticked for this brief. A discarded note is not offered. Nothing is attached automatically, and intake is not blocked when none are ticked. | **Implemented** | `extractableInsights()` and `applySelectedFeedback()` in `src/lib/insights.ts`, called from `createCampaign()` and from `draftFromFounder()` / `resolveInlineEngine()` / `WorkflowRepository.enqueue()`. | `npm run bench` (*UC-06 step 12 / ext 10.a — only a ticked, accepted insight travels forward*) |
| **Step 8 & Ext 8.a** | Store the shared context and log creation. If storage fails, retain a recoverable draft and notify the founder. | **Partial** | Service mode persists atomically to `workflow_campaigns` in `data/workflow.db` (`services/workflow/repository.ts:99`). Browser workspace sync (`src/components/WorkspaceSync.tsx:72-80`) retains `localStorage` draft on failure but does not surface a banner when `PUT /api/workspace` fails. | Deferred UI save-error toast tracked in backlog |
| **Step 9 & Ext 9.a** | Founder reviews the draft and explicitly chooses **Launch agents** (or saves as draft without launching). | **Implemented** | `src/app/campaigns/new/page.tsx` (`submit(true)` vs `submit(false)`). Intake assistant (`CE-08`) always hands the draft to the form and cannot invoke `START`. | `npm run test:intake` (*assistant refuses launch requests*) |
| **Step 10 & Ext 10.a** | Allow at most one active run per campaign. Reject duplicate launches with `409` / escalation log while leaving the active run untouched. | **Implemented** | `runEngine` `START` guard (`src/lib/runtime/engine.ts:355-364`), `assertTransition()` (`src/lib/workflow/commands.ts:37`), and SQLite partial unique index `one_active_campaign` (`services/workflow/repository.ts:31,81-88`). | `npm run bench` (*UC-01 ext 10.a — second launch refused*); `npm run test:workflow` |
| **Step 11 & Ext 11.a** | Show visible run progress and allow the founder to pause/resume. While paused, no agent may research, draft, check, or schedule. | **Implemented** (Engine/Worker) / **Partial** (Campaign Header UI) | `PAUSE` command in `src/lib/runtime/engine.ts:372-386`; cooperative `pause_requested` flag in `services/workflow/repository.ts:83-86,140`. Campaign page header polling for active service jobs is tracked in `CE-03`. | `npm run bench` (*UC-01 step 11 — pause halts bench*); UI polling tracked in [`SCRUM-113`](https://aisle5620.atlassian.net/browse/SCRUM-113) (`CE-03`); seat attribution tracked in [`SCRUM-114`](https://aisle5620.atlassian.net/browse/SCRUM-114) (`CE-04`) |
| **Steps 12–14 & Ext 12.a** | Hand stored context to `AHR-02` (`step: "trend.receive"`), record handoff, and degrade gracefully if the model is unavailable. | **Implemented** | `startIntake()` sets `run.step = "trend.receive"` and executes `runTrendResearch()` (`src/lib/runtime/engine.ts:227-246,367`). Unavailable models fall back to deterministic rules with trace recorded. | `npm run bench`; `npm run test:agents` |
| **Step 13 / Ext 13.a (Any step)** | Block unapproved publication, spending above the founder's threshold, scope changes, self-approval, or unapproved print release; log every refusal as a `PolicyDecision`. | **Implemented** (Media & Action Guard) / **Partial** (Pre-call LLM Spend Guard) | `evaluateGuard()` in `src/lib/runtime/guard.ts:63-228` enforces 7 named rules. Pre-call inference/search cap check is tracked in `CE-02`. | `npm run bench` (*five out-of-bounds agent actions refused and logged*); inference ceiling tracked in [`SCRUM-112`](https://aisle5620.atlassian.net/browse/SCRUM-112) (`CE-02`) |

### 1.2 Stage 1 Class Model → Stage 2 Code Traceability (AHR-01)

| Stage 1 Class (`class-ahr01`) | Stage 2 Code Artifact | Role in Implementation |
|---|---|---|
| `CampaignIntakeController` | `validateIntake()` (`src/lib/runtime/intake.ts`), `startIntake()` (`src/lib/runtime/engine.ts`), `runIntakeTurn()` (`src/lib/intake/assistant.ts`) | Validates founder input, constructs shared context, and initiates the pipeline run. |
| `CampaignDraft` | `CampaignInput` (`src/lib/types.ts:45-66`) + `Campaign` with `status: "draft"` | Holds founder-entered brief fields and `validationProblems` before launch. |
| `CampaignSettings` | `BrandProfile` (`src/lib/types.ts:292-301`) + `WorkspaceSettings` (`src/lib/settings.ts:6-15`) | Supplies retailer name, tone, approved/banned terms, and `countryRules[country]`. |
| `CampaignContext` | `Campaign` scope fields + `Campaign["sharedContext"]` (`SharedContext` in `src/lib/types.ts:204-217`) | Single source of truth read by AHR-02 through AHR-06. |
| `CampaignAuthority` | `evaluateGuard()` (`src/lib/runtime/guard.ts`) + `parseCommand()` / `assertTransition()` (`src/lib/workflow/commands.ts`) | Enforces founder-only commands, spend cap (`spend.capUsd`), print lock, and scope freeze. |
| `PreviousCampaignEvidence` | Saved insight library (`src/lib/insights.ts`) → founder ticks ids → `sharedContext.previousPerformanceNote` & `previousPerformanceFrom` | Carries only the chosen accepted/edited advice, labelled with the product it came from. |
| `PipelineRun` | `AgentRun` (`src/lib/runtime/types.ts:366-381`) + `WorkflowJob` (`src/lib/workflow/types.ts`) | Tracks `status`, `step`, `stepsTaken`, `revisionAttempts`, `awaiting`, and worker leases. |
| `TrendAnalysisHandoff` | Transition `intake.validate` → `trend.receive` in `startIntake()` (`src/lib/runtime/engine.ts:227-246`) | Passes validated `Campaign` + `StepEnv` to `runTrendResearch()`. |
| `CampaignRepository` | `WorkflowRepository` (`services/workflow/repository.ts`) & `loadWorkspace` / `saveWorkspace` (`src/lib/auth/workspace.ts`) | Persists authoritative campaign snapshots (`workflow_campaigns`) and workspace documents. |
| `CampaignAuditEvent` | `AgentEvent` (`campaign.log`), `RunStep` (`campaign.runSteps`), `PolicyDecision` (`campaign.policyDecisions`) | Immutable audit trail of every launch, step, tool call, and policy decision. |

---

## 2. Input Contract (`CampaignInput` & `validateIntake`)

### 2.1 `CampaignInput` Schema (`src/lib/types.ts`)

| Field | Type | Required | Validation Rule (`validateIntake` in `src/lib/runtime/intake.ts`) | Failure Clause | Default / Notes |
|---|---|---|---|---|---|
| `name` | `string` | Yes | `typeof value === "string" && value.trim().length >= 3` | `UC-01 step 4 / ext 3.a` | Campaign title shown on board and reports. |
| `product` | `string` | Yes | `typeof value === "string" && value.trim().length >= 3` | `UC-01 step 4 / ext 3.a` | Hero product(s) promoted in this cycle. |
| `category` | `string` | Yes | `typeof value === "string" && value.trim().length >= 3` | `UC-01 step 4 / ext 3.a` | E.g. `"Grocery"`, `"Apparel"`, `"Pantry"`, `"Home"`, `"Beauty"`. |
| `targetAudience` | `string` | Yes | `typeof value === "string" && value.trim().length >= 3` | `UC-01 step 4 / ext 3.a` | Who the campaign addresses. |
| `objective` | `string` | Yes | `typeof value === "string" && value.trim().length >= 3` | `UC-01 step 4 / ext 3.a` | Commercial/marketing goal for the cycle. |
| `budget` | `number` | Yes | `Number.isFinite(budget) && budget > 0 && budget <= 5_000_000` | `UC-01 ext 4.a` | Founder-entered campaign budget in local currency (AUD). Never suggested by AI. |
| `channels` | `Channel[]` | Yes | Non-empty array; every item in `["instagram", "web", "email", "print", "digital_signage"]` | `UC-01 ext 4.a` | Selected distribution channels. Never altered by agents. |
| `startDate` | `string` | Yes | Valid ISO date `YYYY-MM-DD` | `UC-01 ext 4.a` | Campaign window start date. Never suggested by AI. |
| `endDate` | `string` | Yes | Valid ISO date `YYYY-MM-DD`; `0 <= daysBetween(startDate, endDate) <= 365` | `UC-01 ext 4.a` | Must not precede `startDate` or exceed 365 days. |
| `country` | `Country` | Yes | One of `"AU" \| "NZ" \| "UK" \| "US"` | `UC-01 ext 4.a` | Selects `brand.countryRules[country]` and Open-Meteo centroid. |
| `notes` | `string` | Optional | String (sliced to `<= 4000` chars on command boundary); assistant-drafted notes are prefixed until founder-confirmed | — | Merged into `sharedContext.founderNotes`. |
| `spendCapUsd` | `number` | Optional | Finite number `> 0` when supplied | `UC-01 ext 13.a` | Defaults via `defaultSpendCap()` to `clamp(round(budget * 0.002, 2), 5, 50)` USD. |
| `internalDataAuthorised` | `boolean` | Optional | Boolean (`true` allows `retail.internal_signals`; `false` blocks via `AHR-02-R.privacy`) | `UC-02 ext 4.b` | TA-03: defaults to `false`; explicit `=== true` is required in defaults, engine, repository and tool. Permission alone does not connect a POS source. |
| `fieldSources` | `Partial<Record<keyof CampaignInput, "founder" \| "assistant">>` | Optional | Provenance map recording whether each field was typed by the founder or drafted by the intake assistant | `CE-07 / CE-08` | Displayed on the campaign Brief and Runtime tabs. |
| `intakeLog` | `AgentEvent[]` | Optional | Conversation transcript (`agent: "intake"`, `kind: "intake"`) appended to `campaign.log` on creation | `CE-08` | Preserves the intake assistant transcript for audit. |

### 2.2 Brand & Country-Law Preconditions (`UC-01 step 5 / ext 5.a`)

`validateIntake(input, brand)` additionally requires:
1. `brand !== null` (`"Brand settings are missing. Complete Brand before launching."`, clause `UC-01 ext 5.a`).
2. `Boolean(brand.retailerName?.trim())` (`"Brand retailer name is missing."`, clause `UC-01 ext 5.a`).
3. `Boolean(brand.bannedTerms?.length)` (`"Brand banned-terms list is empty — compliance cannot check claims."`, clause `UC-01 ext 5.a`).
4. `Boolean(brand.countryRules?.[input.country]?.trim())` (`"No advertising-law profile is stored for <country>."`, clause `UC-01 ext 5.a`).

### 2.3 Error Shape (`ValidationProblem`)

```ts
export type ValidationProblem = {
  field: string;   // "name" | "product" | "category" | "targetAudience" | "objective" | "budget" | "channels" | "startDate" | "endDate" | "country" | "brand"
  message: string; // Human-readable explanation shown inline and in campaign.log
  clause: string;  // "UC-01 step 4 / ext 3.a" | "UC-01 ext 4.a" | "UC-01 ext 5.a"
};
```

---

## 3. Output Contract (`SharedContext` & Campaign Scope)

When `blankCampaign()` (`src/lib/seed.ts:86-145`) and `startIntake()` (`src/lib/runtime/engine.ts:181-246`) succeed, they populate `campaign.sharedContext` (`SharedContext`) alongside the frozen top-level scope fields on `Campaign`.

### 3.1 Field-by-Field Reader & Writer Matrix

| Context Field | Type | Populated By | Read By Downstream Agents | Who May Mutate After Launch |
|---|---|---|---|---|
| `campaign.product` / `sharedContext.product` | `string` | Founder (`AHR-01`) | `AHR-02` (tools & prompt), `AHR-03` (copy & poster prompt), `AHR-04` (`inputDigest`), `AHR-05` (channel copy), `AHR-06` (summary & recommendation prompt) | **Nobody (Frozen)** |
| `campaign.category` | `string` | Founder (`AHR-01`) | `AHR-02` (`retail.internal_signals`, `web.market_context`, `web.competitor_scan`), `AHR-03` (`motifPack`), `AHR-04` (`inputDigest`) | **Nobody (Frozen)** |
| `campaign.targetAudience` / `sharedContext.audience` | `string` | Founder (`AHR-01`) | `AHR-02`, `AHR-03`, `AHR-04`, `AHR-05` | **Nobody (Frozen)** |
| `campaign.objective` / `sharedContext.objective` | `string` | Founder (`AHR-01`) | `AHR-02`, `AHR-03`, `AHR-04` (`inputDigest`) | **Nobody (Frozen)** |
| `campaign.budget` | `number` | Founder (`AHR-01`) | `AHR-02` (context), `AHR-04` (high-spend human-judgement check `>= 10,000`), `AHR-05`, `AHR-06` (simulated CPM scaling) | **Nobody (Frozen)** |
| `campaign.channels` | `Channel[]` | Founder (`AHR-01`) | `AHR-02` (`channelRelevance`), `AHR-04` (print & Instagram checks), `AHR-05` (`runMediaAdaptation`, `runSchedule`), `AHR-06` (gap comparison against published versions) | **Nobody (Frozen — guarded by `AHR-05-R.scope`)** |
| `campaign.startDate` / `campaign.endDate` | `string` | Founder (`AHR-01`) | `AHR-02` (`web.season_weather`), `AHR-05` (`runSchedule`, `detectScheduleConflicts`), `AHR-06` (`periodFrom` / `periodTo`) | **Nobody (Frozen — guarded by `AHR-05-R.scope`)** |
| `campaign.country` / `sharedContext.country` | `Country` | Founder (`AHR-01`) | `AHR-02` (`web.season_weather`, `web.competitor_scan`), `AHR-03`, `AHR-04` (`brand.countryRules[country]`), `AHR-05` (timezone) | **Nobody (Frozen)** |
| `sharedContext.retailer` | `string` | `brand.retailerName` (`AHR-01`) | `AHR-02`, `AHR-03`, `AHR-04`, `AHR-05` | **Nobody (Frozen)** |
| `sharedContext.brandTone` | `string` | `brand.tone` (`AHR-01`) | `AHR-02`, `AHR-03`, `AHR-04` (`inputDigest`) | **Nobody (Frozen)** |
| `sharedContext.approvedClaims` | `string[]` | Initialised to `[]` in `AHR-01`; populated by `AHR-02` (`brief.claimsAllowed`) and frozen at `AHR-04` approval (`deriveClearedClaims`) | `AHR-03` (allowed claims), `AHR-04` (`inputDigest`), `AHR-05` (`ChannelVersion.approvedClaims`, guarded by `AHR-05-R.claims-frozen`) | `AHR-02` proposes; frozen upon `AHR-04` founder approval. `AHR-05` may **never** alter cleared claims. |
| `sharedContext.founderNotes` | `string[]` | Initialised from `input.notes` in `AHR-01` | `AHR-02`, `AHR-03`, `AHR-04` (`founderContext(campaign)` in `src/lib/runtime/decide.ts:144-151`) | **Founder only** (via `START`, `APPROVE`, `REQUEST_CHANGES`). Assistant-drafted notes are prefixed until founder-confirmed. |
| `sharedContext.previousPerformanceNote` | `string \| null` | Founder ticks saved insights at intake (`applySelectedFeedback`). Accepting a recommendation does not attach it. | `AHR-02` (`runTrendResearch` records it as a founder-selected insight and does not treat another product's result as a fact about this one) | **Nobody (The chosen sentences stay verbatim)** |
| `sharedContext.previousPerformanceFrom` | `string \| null` | Campaign ids of those chosen insights | `AHR-02` activity log | **Nobody (Frozen)** |
| `campaign.internalDataAuthorised` | `boolean` | Founder (`AHR-01`) | `AHR-02` (`retail.internal_signals` tool and `AHR-02-R.privacy` guard) | **Founder only** |
| `campaign.spend.capUsd` | `number` | Founder (`spendCapUsd` or `defaultSpendCap`) | `AHR-01-R13.spend` guard (`src/lib/runtime/guard.ts:90-119`) | **Founder only** |

> **Immutability Invariant (`UC-01 step 6 & step 13`)**: No agent step (`trend`, `creative`, `compliance`, `media`, or `intake`) may write `product`, `category`, `targetAudience`, `objective`, `budget`, `country`, `startDate`, `endDate`, or `channels`. Any attempt by an agent to alter scope or publish is refused and recorded by `evaluateGuard()` (`AHR-05-R.scope`, `AHR-01-R13.publish`).

---

## 4. Founder Commands & Legal State Transitions

All state-mutating commands pass through `parseCommand()` and `assertTransition()` in `src/lib/workflow/commands.ts`.

| Command `type` | Permitted `actor` | Required Pre-State (`assertTransition`) | Engine Action & Target Post-State |
|---|---|---|---|
| `START` | `"founder"` (`403` otherwise) | `status === "draft" \|\| status === "paused"` | Runs `validateIntake()`. If invalid → stays `"draft"` (`run.status = "halted"`, `awaiting = "brief_correction"`). If valid → stores `sharedContext`, sets `status = "analysing"`, `run.step = "trend.receive"`, and executes the first step. |
| `ADVANCE` | `"founder"` (Gateway) / `"system"` (Worker) | `run?.status === "running"` | Executes up to `maxSteps` bounded steps (`trend.receive` → `creative.receive` → `compliance.receive` ↔ `creative.revise`) until a gate (`founder.gate` or `media.schedule`) or halt. |
| `PAUSE` | `"founder"` | `run?.status === "running" \|\| status === "paused"` | Sets `status = "paused"`, `run.status = "paused"`. In service mode, sets `pause_requested = 1` on the active job so the worker stops after the current step checkpoint. |
| `APPROVE` | `"founder"` | `status === "awaiting_approval" && creatives.length > 0 && complianceAttempts.length > 0` | Records `founderDecision = { action: "approve" }`, marks creatives `"approved"`, sets `run.step = "media.receive"`, and runs `runMediaAdaptation()` + `runSchedule()` → `status = "scheduled"`. |
| `REQUEST_CHANGES` | `"founder"` | `status === "awaiting_approval" && creatives.length > 0` | Appends `command.note` to `sharedContext.founderNotes`. If `nextVersion <= MAX_REVISION_ATTEMPTS`, sets `run.step = "creative.revise"` and regenerates. Otherwise stays at `"awaiting_approval"`. |
| `REJECT` | `"founder"` | `status === "awaiting_approval"` | Sets `status = "rejected"`, `creatives[].status = "rejected"`, `run.status = "halted"`. Nothing is distributed. |
| `PUBLISH` | `"founder"` (`"media"` blocked by guard) | `status === "scheduled" && founderDecision?.action === "approve" && !scheduleConflicts.some(x => !x.resolved)` | Evaluates `AHR-01-R13.publish`, then runs the simulated per-channel delivery (`runPublish`): each channel is submitted and marked `"published"` only on a confirmation; a timed-out send is retried up to `MAX_PUBLISH_RETRIES` (3), never indefinitely; a late result is reconciled by stable item id (idempotent). All confirmed → `status = "published"`, parks `run.step = "feedback.collect"`. If any channel never confirms → the item is recorded `"failed"`, `deliveryReport.outcome` is `"partial"`/`"none"`, the run escalates (`awaiting = "failure"`) under `AHR-05-R.retry-cap`, and `status` stays `"scheduled"` until the founder resolves it. Distribution outcomes are recorded in `campaign.deliveryReport` — see §7. (See `FB-02` / `SCRUM-117` for separating immediate collection from `PUBLISH`.) |
| `COLLECT_FEEDBACK` | `"founder"` | `status === "published"` | Runs `collectChannelResults()`, `buildPerformanceReport()`, and `decideRecommendation()`, parking at `step = "feedback.summarise"` for founder decision. |
| `DECIDE_RECOMMENDATION` | `"founder"` | `status === "published" && Boolean(performanceReport)` | Stores `recommendationDecision` (`"accepted" \| "edited" \| "discarded"`), sets `run.status = "complete"`. |
| `RESOLVE_CONFLICT` | `"founder"` | Unresolved `scheduleConflicts` entry matching `conflictId` | Marks conflict `resolved = true` with founder note; if `0` unresolved remain, sets `run.status = "complete"`. |
| `ATTEMPT_BLOCKED` | `"founder"` (Boundary check UI) | Any status (`true`) | Deliberately frames an out-of-bounds agent action (`PUBLISH_CONTENT`, `SPEND_MEDIA`, `EDIT_APPROVED_CLAIM`, `CHANGE_CAMPAIGN_SCOPE`, `IMPORT_UNAUTHORISED_DATA`, `SKIP_ITEM_SILENTLY`, `APPROVE_OWN_WORK`, `READ_INTERNAL_DATA`) so `evaluateGuard()` blocks and logs it. |

---

## 5. Persistence Ownership & Trust Boundary

1. **Service Mode (`npm run dev:services`, `AISLE_WORKFLOW_URL` set)**:
   - **Authoritative store**: `workflow_campaigns(user_id, campaign_id, snapshot, revision)` in `data/workflow.db`, owned exclusively by `WorkflowRepository` (`services/workflow/repository.ts`).
   - **Trust boundary**: On `START`, `WorkflowRepository.enqueue()` extracts only the permitted `CampaignInput` fields from the request, applies insight ids that exist in `savedInsights`, and constructs a fresh `Campaign` via `blankCampaign()`. A note the browser wrote itself is dropped. Browser-supplied `status`, `log`, `complianceAttempts`, `founderDecision`, `policyDecisions`, `spend`, and `run` are discarded.
   - **Concurrency & Stale-Save Protection**: Each worker checkpoint increments `revision` atomically. When `GET /api/workspace` or `PUT /api/workspace` runs, managed campaigns in `workflow_campaigns` override stale browser copies.
2. **Inline Mode (`npm run dev`, `AISLE_WORKFLOW_URL` unset)**:
   - **Store**: the signed-in workspace row in SQLite locally or PostgreSQL (`DATABASE_URL` in production). The browser keeps `aisle-ws-<userId>` in `localStorage` as a cache.
   - **Trust boundary**: `resolveInlineEngine()` ignores `body.brand` and `body.settings`. `START` rebuilds the campaign from `CampaignInput` plus the stored brand. Every later command loads the stored campaign and runs `assertTransition()` before `runEngine()`. A refused command does not write the workspace.

---

## 6. Example Payloads

### 6.1 Valid Payload — "Spring citrus week" (`validateIntake` → `[]`)

**Founder `CampaignInput`:**

```json
{
  "name": "Spring citrus week",
  "product": "Navel oranges + cold-pressed juice",
  "category": "Grocery",
  "targetAudience": "Inner-west Sydney households and weekend market shoppers, 25–50",
  "objective": "Lift weekly catalogue engagement and fresh-juice basket attach",
  "budget": 12000,
  "channels": ["instagram", "web", "email"],
  "startDate": "2026-10-19",
  "endDate": "2026-11-01",
  "country": "AU",
  "notes": "Focus on orchard provenance and breakfast pairing; no bottle in generated artwork, no health claims.",
  "spendCapUsd": 24,
  "internalDataAuthorised": true
}
```

**Resulting `campaign.sharedContext` (after `blankCampaign` + `startIntake`, with the founder having ticked one saved insight from `cmp_seed_fruit`):**

```json
{
  "retailer": "Lane & Co.",
  "product": "Navel oranges + cold-pressed juice",
  "audience": "Inner-west Sydney households and weekend market shoppers, 25–50",
  "objective": "Lift weekly catalogue engagement and fresh-juice basket attach",
  "country": "AU",
  "brandTone": "Warm, direct, never shouty. Australian English. Speak like a good local shop, not a holding company.",
  "approvedClaims": [],
  "previousPerformanceNote": "KEEP creative_angle: Keep the approved angle “Yellow peaches are in.”: instagram returned the strongest CTR (2.19%) across 3 reporting channel(s).",
  "previousPerformanceFrom": "cmp_seed_fruit",
  "founderNotes": [
    "Focus on orchard provenance and breakfast pairing; no bottle in generated artwork, no health claims."
  ]
}
```

### 6.2 Invalid Payload — Zero Budget, Empty Channels & End Date Before Start Date (`validateIntake` Refusal)

**Invalid `CampaignInput`:**

```json
{
  "name": "Broken citrus draft",
  "product": "Navel oranges",
  "category": "Grocery",
  "targetAudience": "Inner-west households",
  "objective": "Lift weekend basket attach",
  "budget": 0,
  "channels": [],
  "startDate": "2026-09-21",
  "endDate": "2026-09-01",
  "country": "AU",
  "notes": ""
}
```

**Returned `validationProblems` & Halted `EngineResult`:**

```json
{
  "status": "draft",
  "running": false,
  "message": "The pipeline did not start. Budget must be a usable amount greater than zero. Select at least one distribution channel. End date is before the start date.",
  "validationProblems": [
    {
      "field": "budget",
      "message": "Budget must be a usable amount greater than zero.",
      "clause": "UC-01 ext 4.a"
    },
    {
      "field": "channels",
      "message": "Select at least one distribution channel.",
      "clause": "UC-01 ext 4.a"
    },
    {
      "field": "endDate",
      "message": "End date is before the start date.",
      "clause": "UC-01 ext 4.a"
    }
  ],
  "run": {
    "status": "halted",
    "step": "intake.validate",
    "haltedReason": "Budget must be a usable amount greater than zero. Select at least one distribution channel. End date is before the start date.",
    "awaiting": "brief_correction",
    "awaitingDetail": "budget: Budget must be a usable amount greater than zero. · channels: Select at least one distribution channel. · endDate: End date is before the start date."
  }
}
```

---

## 7. AHR-05 Distribution → AHR-06 Output Contract (`DI-01` / `SCRUM-99`)

What AHR-05 produces for AHR-06 (`FB-00` / `FB-01`) once the founder issues `PUBLISH`. Posting to a live channel is **simulated** (no platform client); every field below is written by the engine and read back by AHR-06.

- **Code authorities**: `runMediaAdaptation()`, `runSchedule()`, `detectScheduleConflicts()`, `runPublish()` in `src/lib/runtime/steps.ts`; the channel gateways in `src/lib/runtime/gateways.ts`; the `AIMediaManager`/`Agent` classes in `src/lib/runtime/agents.ts`; `publishNode` in `src/lib/runtime/operation-graph.ts`; guard rules in `src/lib/runtime/guard.ts`.

### 7.1 Per-channel adaptation — `campaign.channelVersions[]` (`ChannelVersion`)

| Field | Type | Meaning |
|---|---|---|
| `channel` | `Channel` | One of the founder's selected channels. |
| `headline` / `body` | `string` | The channel-native copy. The `body` is the caption that will run. |
| `approvedClaims` | `string[]` | The AHR-04-cleared claims this version is frozen against (`deriveClearedClaims`). |
| `claimsUnchanged` | `boolean` | `true` when the body preserved every cleared claim and added none. |
| `captionSource` | `"model" \| "template"` | `"model"` when the Media Manager's LLM wrote a claims-safe platform-native caption (`decideChannelCaptions`); `"template"` when the deterministic adaptation was used (offline, or the model's caption was rejected by the claims guard). |
| `status` | `"adapted" \| "scheduled" \| "published" \| "failed"` | Lifecycle. A channel whose adaptation would change cleared wording is `"failed"` with a `failure` reason and is never published. |
| `failure` | `string?` | Set when the adaptation was withheld/blocked (`AHR-05-R.claims-frozen`). |

### 7.2 Schedule — `campaign.schedule[]` / `campaign.runSchedule[]`

Each item carries `channel`, `at` (publication timestamp), and `status: "scheduled" \| "published" \| "failed"`. `schedule[].id === runSchedule[].id` — this id is the **idempotency key** used to reconcile a late delivery result. Unresolved `campaign.scheduleConflicts[]` (`outside_window` / `same_slot`) block `PUBLISH` until the founder resolves them (`RESOLVE_CONFLICT`).

### 7.3 Distribution outcomes — `campaign.deliveryReport` (`DeliveryReport`)

Written by `runPublish()` on every `PUBLISH`. This is the authoritative "what actually went live" record AHR-06 should read.

```ts
type DeliveryReport = {
  id: string;
  at: string;                 // ISO timestamp of the publish
  attempts: DeliveryAttempt[];
  published: number;          // channels confirmed live
  failed: number;             // channels that never confirmed
  outcome: "complete" | "partial" | "none"; // mixed-run marker (SCRUM-69)
  escalated: boolean;         // true when a channel was raised for the founder
};

type DeliveryAttempt = {
  itemId: string;             // = RunScheduleItem.id (idempotency key)
  channel: Channel;
  attempts: number;           // total submissions: 1 initial + up to 3 retries
  retries: number;            // retries used (= attempts − 1), capped at MAX_PUBLISH_RETRIES (3)
  status: "published" | "failed";
  confirmationRef: string | null; // present only when confirmed — no outcome without a real submission
  reconciled: boolean;        // true when a late result was matched to this itemId, not resubmitted
  latencyMs: number;          // DI-11: publish-and-confirm latency for this item (0 when never submitted)
  note: string;
  at: string;
};
```

### 7.4 Handoff rule (`DI-10` / `SCRUM-108` ↔ `FB-01` / `SCRUM-116`)

Agreed with the AHR-06 owner (Bao Xinlong); the AHR-06 side is the Feedback contract [`docs/contracts/feedback.md`](./feedback.md) (`FB-00` / `SCRUM-119`, implemented by `FB-01` / `SCRUM-116`).

- A `channelVersion` with `status === "failed"` **stays** `"failed"` through `PUBLISH`. A delivery attempt counts as a reporter for AHR-06 **only** when its item reached `status === "published"` **and** carries a `confirmationRef` (no outcome without a real, confirmed publish).
- **Gap rule — OD-2 confirmed (keep the channel, never omit it).** Any founder-selected channel that did **not** meet that test is still surfaced as a gap for the founder — a `ChannelResult` with `figures: null` and one of the agreed reasons — so the founder can see what failed to run (UC-06 ext 4.a). It is excluded from totals but **never dropped from the report**. The agreed reasons are:
  - `not published: adaptation withheld` — the claims-frozen guard blocked the channel's adaptation (`ChannelVersion.status === "failed"`).
  - `not published: delivery not confirmed` — the channel adapted but its submission never confirmed within the retry cap (`deliveryReport` failure).
  - `not published: no live item` — the channel had no scheduled/live item to report on.
- Ownership: the published-only reader that applies this rule (changing `collectChannelResults()` from iterating `campaign.channels` to reading only the published set, with the gap row kept) is **FB-01's** to implement; Distribution keeps the gap-row contract above until Distribution says otherwise.
- While `deliveryReport.outcome` is `"partial"`/`"none"` (a channel unconfirmed), the campaign is held at `status: "scheduled"`, `run.awaiting: "failure"`; `COLLECT_FEEDBACK` is refused until the founder resolves the unconfirmed channels (matches UC-06 ext 2.a). AHR-06 therefore only ever collects from a fully- or partially-published campaign whose live channels carry a `confirmationRef`.

### 7.5 Guardrails enforced on AHR-05 (`evaluateGuard`)

| Rule | Trigger | Effect |
|---|---|---|
| `AHR-05-R.claims-frozen` | An adaptation would drop/alter a cleared claim | Version `"failed"`, `claimsUnchanged: false`; flagged, not published. |
| `AHR-05-R.scope` | Agent tries to add/drop channels or schedule outside `startDate..endDate` | Blocked; a `ScheduleConflict` is raised instead. |
| `AHR-05-R.no-silent-skip` | An item would be skipped without a record | Blocked; raised as an exception for the founder. |
| `AHR-05-R.retry-cap` | A channel is still unconfirmed after the initial send + 3 retries | Blocked; the agent stops and escalates — never retries forever, never skips. |
| `AHR-01-R13.publish` | Any non-founder actor attempts `PUBLISH` (stricter for `print`) | Blocked; only the founder may publish. |

### 7.6 Example — `deliveryReport` (complete) and (partial)

```json
{
  "outcome": "complete",
  "published": 3,
  "failed": 0,
  "escalated": false,
  "attempts": [
    { "channel": "web",   "attempts": 2, "retries": 1, "status": "published", "confirmationRef": "web-cw",   "reconciled": false },
    { "channel": "email", "attempts": 4, "retries": 3, "status": "published", "confirmationRef": "email-1d", "reconciled": true  },
    { "channel": "print", "attempts": 1, "retries": 0, "status": "published", "confirmationRef": "print-9a", "reconciled": false }
  ]
}
```

```json
{
  "outcome": "partial",
  "published": 2,
  "failed": 1,
  "escalated": true,
  "attempts": [
    { "channel": "web",   "attempts": 4, "retries": 3, "status": "failed",    "confirmationRef": null,       "reconciled": false },
    { "channel": "email", "attempts": 1, "retries": 0, "status": "published", "confirmationRef": "email-1d", "reconciled": false },
    { "channel": "print", "attempts": 1, "retries": 0, "status": "published", "confirmationRef": "print-9a", "reconciled": false }
  ]
}
```

**Automated proof**: `npm run bench` — *UC-05 ext 6.a — bounded retry + late-result reconciliation, then collect*; *UC-05 ext 6.a — unconfirmed channel capped, escalated, never skipped silently*; *AHR-05 — AI per-channel captions, guard-safe (claims-frozen)*.

### 7.7 Channel gateways & the Media Manager agent (`DI-02` / `SCRUM-100`)

Distribution is served by gateways, not a live platform client. `src/lib/runtime/gateways.ts` defines the `DistributionChannelGateway` interface — `getChannelType()`, `supportsFormat()`, `isAvailable()`, `publish()` — and two **simulated** implementations, selected by channel type:

| Gateway | `getChannelType` | Channels | `supportsFormat` | Release |
|---|---|---|---|---|
| `digitalGateway` | `"digital"` | `instagram`, `web`, `email` | `image` / `html` / `text` | Simulated submission (`publish()` → `DeliveryAttempt`) |
| `physicalGateway` | `"physical"` | `print`, `digital_signage` (in-store signage) | `print` / `signage` / `image` | Simulated submission (`publish()` → `DeliveryAttempt`) |

`channelTypeOf(channel)` maps a channel to its type and `selectGateway(channel)` returns the gateway; `runPublish()` publishes each scheduled item through `selectGateway(item.channel).publish(...)`. The two gateways are registered in `GATEWAYS: Record<ChannelType, DistributionChannelGateway>`. **No live platform client exists** — a real transport is added later by implementing the same interface.

`src/lib/runtime/agents.ts` provides the Stage-1 class model as Stage-2 code: an abstract `Agent` base and `AIMediaManager extends Agent` (`slot: "media"`) whose `adapt()` / `schedule()` / `publish()` operations delegate to the step handlers.

**Automated proof**: `npm run bench` — *DI-02 — Media Manager agent generalizes Agent; digital/physical gateways registered & selected*.

### 7.8 Receive & verify distribution context (`DI-03` / `SCRUM-101`)

Before any adaptation, `verifyDistributionContext()` (`src/lib/runtime/steps.ts`, called at the top of `runMediaAdaptation`) confirms the distribution context and records it on `campaign.distributionContext` (`DistributionContext`):

- **Approved only.** Distribution begins only for an AHR-04-approved advertisement (`founderDecision.action === "approve"` or a compliance `pass`); otherwise it is refused.
- **Compliance approval id recorded** — the passing compliance attempt's id (falling back to the last reviewed attempt), carried on `distributionContext.complianceApprovalId`.
- **Authorised channel access loaded** — for each selected channel, `{ channel, type, available }` from `selectGateway(channel).isAvailable(channel)`.
- **Invalid input blocks with a reason + founder notification** — missing context (`channels`, `startDate`, `endDate`, `country`, `targetAudience`) or an unavailable channel sets `ok: false` with a `reason`, raises a founder escalation event, and parks the run (`run.awaiting: "failure"`, `step: "media.receive"`) — nothing is adapted or scheduled.

**Automated proof**: `npm run bench` — *DI-03 — approved ad received, context verified (approval id + channel auth)*.

### 7.9 Pause, cancellation & late results; latency (`DI-08` / `SCRUM-106`, `DI-11` / `SCRUM-109`)

- **Pause/cancel (DI-08).** Pause/resume is owned by the **run** (the pipeline), never the individual item: a paused campaign is not `scheduled`, so `publishNode` refuses to start a publish. A result that returns after the publish loop has moved on is handled by `reconcileLateResult(campaign, itemId, confirmationRef, now)`: it matches the stable `itemId` and records the confirmation as **fact** (`reconciled: true`), never a second publish (an already-`published` item returns `already_published`); a result for an id no longer held — e.g. a cancelled item — returns `ignored_unknown` and is never invented into a publish.
- **Latency (DI-11).** Each `DeliveryAttempt` records a simulated `latencyMs` (publish-and-confirm time; `0` when never submitted). A late-reconciled item carries the highest latency (it timed out before the late confirmation). The bench evaluates success, partial, divergent-withheld (a claims-frozen withheld channel), retry-exhaustion and late-result cases, asserting claims stay frozen, retries are capped, every escalation reaches the founder, no outcome exists without a real publish, and scope is not exceeded.

**Automated proof**: `npm run bench` — *DI-08 — pause respected; late result reconciled by id; duplicate & unknown handled*; *DI-11 — publish-and-confirm latency recorded per item (late costs most)*.

## TA-03 evidence contract amendment (18 October 2026)

`campaign.evidence` remains the evidence ledger. `observedAt` now accepts `null`
(unknown information date); `fetchedAt` always records retrieval time. Optional
`dateBasis` distinguishes page revision, source record and unknown dates. Forecast
`coverage` records its validity window and sample city separately. Existing string
dates remain compatible. A successful fetch is not proof of a general market trend.

`campaign.dataAccessPolicy.externalSources` optionally narrows the registered
public-source allowlist; an empty list denies all external research. An absent
policy uses the fixed prototype policy documented in [TA-03](../TA-03-AUTHORISED-EVIDENCE.md).
The durable repository persists the policy on initial intake. It is not generated
by the LLM. Internal access is denied unless explicitly true.

Trend research pauses before creative handoff when no usable external evidence
exists or unresolved source/conflict/currency gaps need founder attention. Partial
briefs and provenance remain stored; `approvedClaims` is empty while blocked.
This is a minimum retrieval gate, not the complete UC-02 category-sufficiency and
founder-resolution workflow. See the TA-03 document for those remaining boundaries.

### TA-03 required-area execution (21 October 2026, local)

`Campaign.researchAttempts` records category, optional channel, tool, status, summary and evidence IDs for mandatory collection. `researchCoverage` includes every mandatory area and each selected channel even when missing/blocked. Its optional `analysis` is a source-cited draft; retrieval and syntactically valid citations never certify COMPLETE. `retailUpload` holds explicitly authorised validated aggregate rows plus file SHA-256/import time; raw customer data is rejected. See `docs/TA-03-AUTHORISED-EVIDENCE.md` for scope and unresolved acceptance items.
