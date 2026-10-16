# AHR-01 Context Entry & Shared `CampaignContext` Contract (`CE-00` / `SCRUM-118`)

- **Jira Ticket**: [`SCRUM-118`](https://aisle5620.atlassian.net/browse/SCRUM-118) (`CE-00 — Confirm Context Entry scope and the CampaignContext contract every agent consumes`)
- **Epic**: [`SCRUM-13`](https://aisle5620.atlassian.net/browse/SCRUM-13) (`AHR-01 Context Entry`)
- **Owner**: Xinlong Bao (Harry)
- **Reviewed Downstream Contracts**: [`SCRUM-27`](https://aisle5620.atlassian.net/browse/SCRUM-27) (`TA-01 — AHR-02 Trend Analysis`) · [`SCRUM-99`](https://aisle5620.atlassian.net/browse/SCRUM-99) (`DI-01 — AHR-05 Distribution`)
- **Code Authorities**:
  - `src/lib/runtime/intake.ts` (`validateIntake`, `inputDigest`, `digestHash`, `COUNTRIES`, `CHANNELS`)
  - `src/lib/runtime/engine.ts` (`startIntake`, `runEngine`)
  - `src/lib/runtime/guard.ts` (`evaluateGuard`, `guardRuleCatalogue`)
  - `src/lib/runtime/defaults.ts` (`withRuntimeDefaults`, `defaultSpendCap`, `attachableRecommendation`)
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
| **Step 6** | Create one shared campaign context from the validated brief and brand settings without inventing product, audience, budget, country, or channels. Apply publication, spend, and human-decision boundaries before any agent starts. | **Implemented** (Service mode) / **Partial** (Inline mode) | `makeContext()` and `blankCampaign()` in `src/lib/seed.ts:64-108`; `startIntake()` in `src/lib/runtime/engine.ts:206-246`; `WorkflowRepository.enqueue()` in `services/workflow/repository.ts:90-100`. Inline route `/api/engine` still accepts `body.brand` and browser `campaign` fields. | `npm run test:workflow`; inline trust boundary tracked in [`SCRUM-111`](https://aisle5620.atlassian.net/browse/SCRUM-111) (`CE-01`, Sprint 2) |
| **Step 7 & Ext 7.a** | Attach the most recent `accepted` or `edited` AHR-06 recommendation unchanged with its source campaign ID (`previousPerformanceFrom`). Skip `discarded` or missing notes without blocking intake. | **Implemented** | `attachableRecommendation()` in `src/lib/runtime/defaults.ts:104-131`, called in `src/lib/store.ts:197` and `services/workflow/repository.ts:95`. | `npm run bench` (*UC-06 step 12 / ext 10.a — only accepted notes travel forward*) |
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
| `PreviousCampaignEvidence` | `attachableRecommendation()` (`src/lib/runtime/defaults.ts:104-131`) → `sharedContext.previousPerformanceNote` & `previousPerformanceFrom` | Carries accepted/edited AHR-06 advice verbatim into the new campaign. |
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
| `internalDataAuthorised` | `boolean` | Optional | Boolean (`true` allows `retail.internal_signals`; `false` blocks via `AHR-02-R.privacy`) | `UC-02 ext 4.b` | Defaults to `true` in `withRuntimeDefaults()`; explicit `=== true` in `repository.enqueue()`. |
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
| `sharedContext.previousPerformanceNote` | `string \| null` | `attachableRecommendation()` in `AHR-01` (`UC-01 step 7`) | `AHR-02` (`runTrendResearch` folds it into `Evidence` & `TrendFinding` with `sourceName: "AHR-06 accepted recommendation"`) | **Nobody (Attached verbatim, never rewritten)** |
| `sharedContext.previousPerformanceFrom` | `string \| null` | `attachableRecommendation()` in `AHR-01` (`UC-01 step 7`) | `AHR-02` (`sourceRef: "campaign://<id>"` on the raised `Evidence` row) | **Nobody (Frozen)** |
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
| `PUBLISH` | `"founder"` (`"media"` blocked by guard) | `status === "scheduled" && founderDecision?.action === "approve" && !scheduleConflicts.some(x => !x.resolved)` | Evaluates `AHR-01-R13.publish`. Marks scheduled items and non-failed `channelVersions` as `"published"`, sets `status = "published"`, and parks `run.step = "feedback.collect"`. (See `FB-02` / `SCRUM-117` for separating immediate collection from `PUBLISH`.) |
| `COLLECT_FEEDBACK` | `"founder"` | `status === "published"` | Runs `collectChannelResults()`, `buildPerformanceReport()`, and `decideRecommendation()`, parking at `step = "feedback.summarise"` for founder decision. |
| `DECIDE_RECOMMENDATION` | `"founder"` | `status === "published" && Boolean(performanceReport)` | Stores `recommendationDecision` (`"accepted" \| "edited" \| "discarded"`), sets `run.status = "complete"`. |
| `RESOLVE_CONFLICT` | `"founder"` | Unresolved `scheduleConflicts` entry matching `conflictId` | Marks conflict `resolved = true` with founder note; if `0` unresolved remain, sets `run.status = "complete"`. |
| `ATTEMPT_BLOCKED` | `"founder"` (Boundary check UI) | Any status (`true`) | Deliberately frames an out-of-bounds agent action (`PUBLISH_CONTENT`, `SPEND_MEDIA`, `EDIT_APPROVED_CLAIM`, `CHANGE_CAMPAIGN_SCOPE`, `IMPORT_UNAUTHORISED_DATA`, `SKIP_ITEM_SILENTLY`, `APPROVE_OWN_WORK`, `READ_INTERNAL_DATA`) so `evaluateGuard()` blocks and logs it. |

---

## 5. Persistence Ownership & Trust Boundary

1. **Service Mode (`npm run dev:services`, `AISLE_WORKFLOW_URL` set)**:
   - **Authoritative store**: `workflow_campaigns(user_id, campaign_id, snapshot, revision)` in `data/workflow.db`, owned exclusively by `WorkflowRepository` (`services/workflow/repository.ts`).
   - **Trust boundary**: On `START`, `WorkflowRepository.enqueue()` extracts only the permitted `CampaignInput` fields from the request, attaches `attachableRecommendation(this.campaigns(user))` from the server's own snapshots, and constructs a fresh `Campaign` via `blankCampaign()`. Browser-supplied `status`, `log`, `complianceAttempts`, `founderDecision`, `policyDecisions`, `spend`, and `run` are discarded.
   - **Concurrency & Stale-Save Protection**: Each worker checkpoint increments `revision` atomically. When `GET /api/workspace` or `PUT /api/workspace` runs, managed campaigns in `workflow_campaigns` override stale browser copies.
2. **Inline Mode (`npm run dev`, `AISLE_WORKFLOW_URL` unset)**:
   - **Store**: `workspaces(user_id, doc, updated_at)` in `data/aisle.db` (SQLite locally) or PostgreSQL (`DATABASE_URL` in production), mirrored to browser `localStorage` (`aisle-ws-<userId>`).
   - **Known gap (`CE-01` / [`SCRUM-111`](https://aisle5620.atlassian.net/browse/SCRUM-111))**: `src/app/api/engine/route.ts:93` currently reads `const brand = (body.brand as typeof stored.brand) ?? stored.brand` and passes `body.campaign` into `runEngine()`. `CE-01` ports `WorkflowRepository.enqueue()`'s server-side reconstruction and `assertTransition()` check into the inline `/api/engine` route.

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

**Resulting `campaign.sharedContext` (after `blankCampaign` + `startIntake` with prior accepted recommendation from `cmp_seed_fruit`):**

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
