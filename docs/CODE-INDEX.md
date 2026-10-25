# Aisle code index

Updated: 2026-10-23

This is a map of the source tree: where each file lives and what it is responsible for. How to clone and run the app is in [README.md](../README.md). Stage-by-stage requirement traceability is in [STAGE2-IMPLEMENTATION.md](STAGE2-IMPLEMENTATION.md).

Aisle is a Next.js app. One signed-in founder owns a workspace (brand, settings, campaigns). Four agents — Trend, Creative, Compliance, Media — advance a campaign one command at a time. The founder is the only actor who can approve or publish.

## How a campaign command moves

```
browser  useAisle (src/lib/store.ts)
           sendCommand (src/lib/runtime/client.ts)
              │
              ▼
         POST /api/engine          src/app/api/engine/route.ts
              │
              ├─ durable mode ──► services/workflow  (worker calls runEngine)
              │
              └─ inline mode ───► resolveInlineEngine   src/lib/workflow/inline.ts
                                    brand + run state come from the saved workspace
                                    │
                                    ▼
                                 runEngine              src/lib/runtime/engine.ts
                                    │
                                    ▼
                                 LangGraph              src/lib/runtime/operation-graph.ts
                                    │
                                    ▼
                                 one step               src/lib/runtime/steps.ts
                                    ├── decide.ts       model or deterministic decision
                                    ├── guard.ts        refuse publish / overspend / scope change
                                    └── tools.ts        weather, market, shelf prices, competitors
```

The browser names the command and, on `START`, the brief. It does not get to replace brand rules or agent progress. That cut is `resolveInlineEngine`. The durable worker makes the same cut in `WorkflowRepository.enqueue`.

## Top of the repo

| Path | What it is |
|---|---|
| `src/app` | Pages and HTTP routes (Next.js App Router). |
| `src/components` | React UI. |
| `src/lib` | Domain logic. Routes stay thin and call into here. |
| `src/proxy.ts` | Sign-in gate. Public paths are `/`, `/login`, `/signup`, `/api/auth/*`, `/api/health`. Everything else redirects to login. |
| `services/workflow` | Durable campaign worker: queue, claim, heartbeat, resume after the tab closes. |
| `services/media` | Background worker for story-ad production. |
| `services/knowledge/law/AU` | Australian advertising-law texts the compliance checker retrieves. |
| `scripts` | Offline test suites and owner tools (`npm run test:*`, `npm run bench`, `npm run user`). |
| `docs` | Design notes and this index. |
| `langgraph.json` | Graphs LangSmith Studio can draw: `operation`, `trend`, `creative`, `compliance`, `media`, `intake`. |
| `data/` | Local SQLite file and generated media. Not part of the app source. |

## Pages (`src/app`)

`layout.tsx` wraps signed-in pages in the sidebar shell. `page.tsx` shows the marketing landing when signed out and the overview when signed in.

| Route | File | What the page does |
|---|---|---|
| `/` | `page.tsx` | Landing or the founder overview. |
| `/login`, `/signup` | `login/page.tsx`, `signup/page.tsx` | Account forms. |
| `/campaigns` | `campaigns/page.tsx` | Campaign list. |
| `/campaigns/new` | `campaigns/new/page.tsx` | New brief, including the intake chatbot. |
| `/campaigns/[id]` | `campaigns/[id]/page.tsx` | One campaign: brief, research, studio, compliance, channels, feedback, runtime, log. |
| `/campaigns/trash` | `campaigns/trash/page.tsx` | Archived campaigns. |
| `/trends` | `trends/page.tsx` | Trend sources: URLs, feeds, uploaded documents. |
| `/studio` | `studio/page.tsx` | Content generation workbench. |
| `/approvals` | `approvals/page.tsx` | Founder queue: approve, request changes, reject, resolve schedule conflicts. |
| `/schedule` | `schedule/page.tsx` | Channel posting times. |
| `/performance` | `performance/page.tsx` | Collected results and the next-campaign recommendation. |
| `/brand` | `brand/page.tsx` | Tone, terms, country, guideline documents, retail upload. |
| `/settings` | `settings/page.tsx` | Models, connections, profile. |
| `/library` | `library/page.tsx` | Generated images and videos for this account. |
| `/billing` | `billing/page.tsx` | Plan, credits, Stripe checkout and portal. |
| `/account/usage` | `account/usage/page.tsx` | Credit ledger and recent usage. |
| `/operations` | `operations/page.tsx` | Durable workflow jobs, when that mode is on. |

## HTTP routes (`src/app/api`)

Each file exports the verbs Next.js calls (`GET`, `POST`, …).

| Route | What it does |
|---|---|
| `auth/signup`, `auth/login`, `auth/logout`, `auth/me` | Create an account, start or end a session, read or rename the current user. |
| `auth/google`, `auth/google/callback` | Google sign-in redirect and return. |
| `auth/apple`, `auth/apple/callback` | Apple sign-in start and the form post Apple sends back. |
| `workspace` | Read and save the signed-in workspace JSON. |
| `engine` | One agent command. Inline mode rebuilds the campaign from the stored workspace, then runs the engine. Durable mode enqueues a job. |
| `engine/graph` | Whether an Agent Server graph is reachable for this desk. |
| `engine/guard` | Ask the policy guard about one proposed action. |
| `engine/jobs`, `engine/jobs/[id]` | List durable jobs, read one, retry one. |
| `intake/chat` | One turn of the conversational brief assistant. |
| `brand/research` | Look the brand up on the web before a brief is written. |
| `guidelines/extract` | Pull text out of an uploaded brand PDF or Word file. |
| `studio/generate` | Render a poster or video for a campaign. |
| `studio/revise` | Rewrite image prompts after a compliance send-back. |
| `studio/providers` | Which media providers this server can call. |
| `studio/progress/[campaignId]` | Render progress for a campaign. |
| `studio/download` | Download a finished asset. |
| `studio/assets/...` | Read one stored asset by campaign, kind, and id. |
| `library`, `library/[id]` | List account assets, or read and delete one. |
| `retail-data/[id]` | Read a parsed retail upload attached to a campaign. |
| `whichgrocer/connect`, `callback`, `disconnect`, `status` | WhichGrocer OAuth: start, store the token, drop it, report whether it is connected. |
| `billing`, `billing/checkout`, `billing/portal` | Credit summary, start Stripe Checkout, open the customer portal. |
| `stripe/webhook` | Apply a verified Stripe event to the credit ledger. |
| `settings/status`, `settings/test` | Which provider keys are present, and a live test of one key. |
| `health` | Which database backend is up. No account data. |

## Components (`src/components`)

| File | What it draws |
|---|---|
| `AppShell.tsx` | Sidebar and page frame. |
| `Landing.tsx` | Signed-out marketing page. |
| `Overview.tsx` | Signed-in home: campaign counts and reset-demo. |
| `WorkspaceSync.tsx` | Keeps the Zustand store and `/api/workspace` in step. |
| `UserMenu.tsx` | Account menu in the header. |
| `AuthForm.tsx` | Shared login and signup fields. |
| `BrandLogo.tsx` | Cart mark and wordmark. |
| `ChannelIcon.tsx` | Icon for a distribution channel. |
| `ui.tsx` | Shared badges, stats, empty states, page headers. |
| `AgentLog.tsx` | The campaign event log. |
| `OperationGraph.tsx` | The pipeline diagram on a campaign. |
| `ChecksPanel.tsx` | Compliance issues on the approval card. |
| `ComplianceCheckerPanel.tsx` | The compliance review panel. |
| `ComplianceReviewHistory.tsx` | Earlier compliance attempts. |
| `RetailDataPanel.tsx` | Uploaded retail rows on the brand page. |
| `InstagramPost.tsx` | A preview of a post. |
| `intake/IntakeChatbot.tsx` | Chat that fills the new-campaign form. |
| `studio/CreativeStudio.tsx` | Studio page body: pick a campaign and open the workbench. |
| `studio/AdWorkbench.tsx` | Generate and compare ad variants. |
| `studio/CampaignContent.tsx` | Copy and assets for the selected campaign. |
| `studio/GenerationInfo.tsx` | Model, cost, and timing of one render. |
| `studio/RenderProgress.tsx` | Live render stages. |
| `studio/useMediaProviders.ts` | Loads `/api/studio/providers` for the workbench. |
| `settings/ModelTable.tsx` | Per-agent model picker. |
| `settings/ProviderRow.tsx` | One provider key row: status, paste, test. |
| `settings/ProfileSection.tsx` | Display name. |
| `settings/WhichGrocerConnect.tsx` | Connect or disconnect WhichGrocer. |
| `billing/BillingView.tsx` | Plan and credit purchase UI. |
| `billing/CreditsBadge.tsx` | Header balance. |
| `billing/events.ts` | `BILLING_CHANGED` window event so the badge refreshes. |
| `billing/examples.ts` | "What credits buy", priced from the same catalogs the meter uses. |

## Browser state and shared types

| File | What it does |
|---|---|
| `src/lib/store.ts` | Zustand store `useAisle`: campaigns, brand, settings, and the commands the pages call (`approve`, `collectFeedback`, and the rest). Those commands go to the server through `sendCommand`. |
| `src/lib/runtime/client.ts` | `sendCommand` posts `{ campaign, command, brand, settings }` to `/api/engine`. The server ignores brand and settings. |
| `src/lib/types.ts` | Campaign, brand, brief, creative, and status types shared by UI and engine. |
| `src/lib/runtime/types.ts` | Run types: commands, evidence, guard decisions, compliance attempts, spend, channel results. |
| `src/lib/settings.ts` | Workspace settings: model assignments and trend sources. `withSettingsDefaults` fills older documents. |
| `src/lib/seed.ts` | `defaultBrand`, `blankCampaign`, and the demo campaigns. `blankCampaign` starts a draft with empty compliance history, no founder decision, and no run. |
| `src/lib/status.ts` | Labels and order for statuses, agents, and channels. |
| `src/lib/ids.ts` | Id and date/number formatters. |
| `src/lib/cn.ts` | Class-name join helper. |
| `src/lib/campaign-lifecycle.ts` | `isArchived` and the fields a trash/restore must keep. |

## Agent bench (`src/lib/runtime`)

| File | What it does |
|---|---|
| `engine.ts` | `runEngine(workspace, campaign, command, settings, brand)`. Opens a work record, runs the operation graph, seals the campaign. |
| `operation-graph.ts` | LangGraph of the bench. Nodes are intake, each agent stage, approve, request-changes, reject, pause, publish, collect, decide. |
| `operation-diagram.ts` | The same nodes in the order the founder diagram shows them. |
| `steps.ts` | The work inside a node. See the function list below. |
| `decide.ts` | One model decision each: trend brief, copy, image-prompt rewrite, compliance, captions, recommendation. Falls back to deterministic copy when no live model is configured. |
| `guard.ts` | `evaluateGuard`. Agents may research, draft, and check. They may not publish, overspend, change scope, or send a cover live. |
| `tools.ts` | Tool registry: internal retail, market context, competitor scan, season and weather, shelf prices. Each call records evidence or a limitation. |
| `intake.ts` | Validates a brief. Refuses to invent product, audience, budget, country, or channels. |
| `defaults.ts` | `withRuntimeDefaults` fills missing run fields on old campaigns. |
| `resume.ts` | Whether a saved campaign still has agent work, and how to merge a stale list without rewinding a run. |
| `budget.ts` | Default spend cap. |
| `gateways.ts` | Digital and physical channel gateways the Media Manager selects. They do not call a live ad platform. |
| `agents.ts` | `AIMediaManager`, the class wrapper the Stage 1 model asked for. |

### `steps.ts` functions

| Function | What it does |
|---|---|
| `setRun`, `addEvent`, `addStep`, `addEvidence`, `recordPolicy`, `addTrace` | Write the run pointer, log line, step, evidence row, guard decision, or model trace onto the campaign. |
| `callTool` | Run one registered tool and store what it returned. |
| `runTrendResearch` | Collect market evidence, then ask for a trend brief. |
| `runCreativeGeneration` | Build two creative variants and their prompts. |
| `receiveComplianceSubmission` | Snapshot the creative the checker will review. |
| `runComplianceReview` | Law retrieval, poster images, policy rules, and the compliance decision. Writes the structured report. |
| `deriveClearedClaims` | Claims that survived review and must not be rewritten later. |
| `runMediaAdaptation` | Channel versions. Cleared claims stay frozen. |
| `detectScheduleConflicts`, `runSchedule` | Flag overlaps, then place the campaign on the calendar. |
| `runPublish` | Publish only after the founder approved and conflicts are resolved. |
| `collectChannelResults`, `runFeedbackCollection` | Record per-channel results. Missing figures stay missing. |
| `buildPerformanceReport`, `deterministicRecommendation` | The results summary and the suggested next campaign. |
| `motifPack`, `palettesFor`, `deterministicCopy`, `buildCreatives` | Fallback creative content when a model is not used. |

## Decisions, seats, and models

| File | What it does |
|---|---|
| `src/lib/agents/seats.ts` | Compiles the five LangGraph seats: trend, creative, compliance, media, intake. |
| `src/lib/agents/agent-runtime.ts` | `runSeatAgent`: run one seat and turn the answer into a trace. |
| `src/lib/agents/agent-tools.ts` | Exposes the runtime tool registry to LangChain. |
| `src/lib/agents/metered-chat-model.ts` | LangChain chat model that calls `runComplete`, so every seat call is metered. |
| `src/lib/agents/trend-runtime.ts` | Bounded trend decision. It consumes evidence already collected. It does not call more tools. |
| `src/lib/agents/trend-server.ts` | Builds the LLM runtime the engine and the worker inject. Compliance with a signed-in user goes through the metered path. |
| `src/lib/studio/operation.ts` | The bench graph Studio can run. Hydrates a campaign id plus a command. |
| `src/lib/studio/seats.ts` | The same five seats, served to Studio. |
| `src/lib/studio/remote.ts` | Calls the Agent Server from the Next.js route and reads the graph outcome. |
| `src/lib/studio/context.ts` | Loads a campaign for Studio, which has no session cookie. |
| `src/lib/llm/types.ts` | Request and result shapes: model, images, billing, purpose. |
| `src/lib/llm/catalog.ts` | Offered LLM providers, models, and the default per agent slot. |
| `src/lib/llm/presets.ts` | Cheapest, balanced, and best-quality assignment sets. |
| `src/lib/llm/complete.ts` | Client-safe one-argument completion. |
| `src/lib/llm/metered-complete.ts` | Server completion. Reserves credits, calls the signed-in model, settles the real cost. A vision or `direct` call is not rerouted to the local model. |
| `src/lib/llm/estimate.ts` | Token and dollar estimates, including image tokens. |
| `src/lib/llm/adapters.ts` | Builds and sends the provider HTTP body. |
| `src/lib/llm/response-schemas.ts` | Strict JSON schemas for trend briefs and copy. |
| `src/lib/llm/search.ts` | Web search on the seat's own provider, used when researching a brand. |
| `src/lib/llm/langsmith.ts` | Names and wraps a model call so it shows up as a trace. |
| `src/lib/llm/stub.ts` | Deterministic completion for tests and the no-key path. |
| `src/lib/backends.ts` | "Apply one backend to all": local or cloud defaults for text, image, and video. |

## Compliance and advertising law

| File | What it does |
|---|---|
| `src/lib/compliance/checks.ts` | `checkSubmission`. Records that phrase, price, and image scans are not done here. |
| `src/lib/compliance/rules.ts` | Policy registry. Uploaded ad text cannot add a rule. |
| `src/lib/compliance/document-review.ts` | Compares the ad with an uploaded source document. |
| `src/lib/compliance/outcome.ts` | Maps policy, document, and image problems to pass, changes required, or manual review. |
| `src/lib/compliance/report.ts` | The structured compliance report. |
| `src/lib/compliance/posters.ts` | Poster bytes attached to a compliance request. |
| `src/lib/compliance/service.ts` | Parse a submission, check permission, begin a review. |
| `src/lib/compliance/knowledge/store.ts` | Passage store for uploaded compliance knowledge. |
| `src/lib/advertising-law/index.ts` | Loads the AU law pack and retrieves passages for a market. |
| `src/lib/guidelines.ts` | Limits and prompt text for uploaded brand guidelines. |
| `src/lib/brand/research.ts` | Brand research result used by `/api/brand/research`. |

## Intake

| File | What it does |
|---|---|
| `src/lib/intake/shared.ts` | Browser-safe draft types, the field list, and the empty draft. |
| `src/lib/intake/assistant.ts` | One interview turn. It will not invent a brief field, and it will not run a campaign command from chat. |

## Workflow trust boundary

| File | What it does |
|---|---|
| `src/lib/workflow/commands.ts` | `parseCommand` allows only a founder (except a recorded blocked attempt). `assertTransition` refuses a command the stored status does not allow. |
| `src/lib/workflow/inline.ts` | `resolveInlineEngine`. Ignores browser brand and settings. `START` rebuilds a draft from the brief and the stored brand. Later commands clone the stored campaign and assert the transition. |
| `src/lib/workflow/gateway.ts` | Talks to the durable workflow service: submit, read, retry, list. |
| `src/lib/workflow/types.ts` | Job and submission types. |
| `services/workflow/repository.ts` | SQL queue. `enqueue` strips forged run state, enforces one active job, and stores idempotency keys. |
| `services/workflow/worker.ts` | `workOnce`. Claims a job, runs the engine step by step, stops at the human gate, heartbeats the lease. |
| `services/workflow/api.ts` | HTTP API the Next.js app calls when durable mode is on. |

## Accounts and the database

| File | What it does |
|---|---|
| `src/lib/db/index.ts` | Opens SQLite locally, or Postgres when `DATABASE_URL` is set. Runs `migrate`. |
| `src/lib/db/sqlite.ts` | SQLite file adapter (`data/aisle.db` in development). |
| `src/lib/db/postgres.ts` | Hosted Postgres adapter. |
| `src/lib/db/schema.ts` | Creates the tables below and adds columns that arrived later. |
| `src/lib/db/types.ts` | The small interface both drivers implement. |
| `src/lib/db/kv.ts` | Get, set, and list JSON documents in the `kv` table. |
| `src/lib/auth/users.ts` | Create, find, and update accounts. Email uniqueness is a database constraint. |
| `src/lib/auth/password.ts` | Hash, verify, and validate passwords. |
| `src/lib/auth/session.ts` | Sign and read the `aisle_session` cookie. |
| `src/lib/auth/current.ts` | `getCurrentUser` for route handlers. |
| `src/lib/auth/workspace.ts` | Load and save `workspace/<userId>`. |
| `src/lib/auth/oauth.ts` | Google and Apple redirects. Both finish as an Aisle session. |
| `src/lib/auth/oauth-users.ts` | Link a provider subject to an account. |
| `src/lib/auth/seed-accounts.ts` | The five demo desks. |
| `src/lib/auth/storage-errors.ts` | Founder-facing message when the database is down. |
| `src/lib/auth/types.ts` | `PublicUser`, `AuthUser`, roles. |
| `src/lib/auth/kv.ts` | Older workspace helper. New code uses `db/kv.ts`. |

### Tables in `schema.ts`

| Table | What it stores |
|---|---|
| `users` | Account, password hash, Google and Apple subjects, session version. |
| `kv` | Workspace JSON and other documents, keyed by string. |
| `credit_accounts` | Balance in milli-credits. |
| `credit_holds` | A reserve taken before a provider call, settled or released after. |
| `credit_ledger` | Every grant, charge, and adjustment. |
| `free_grants` | Daily free-credit grants. |
| `signup_attempts` | Signup rate limiting. |
| `billing_customers` | Stripe customer and subscription status. |
| `stripe_events` | Webhook ids already applied. |
| `whichgrocer_connections` | OAuth tokens. These are not copied into the workspace the browser syncs. |
| `media_objects` | Generated image and video bytes. |
| `account_assets` | Library rows pointing at those objects. |

## Credits

| File | What it does |
|---|---|
| `src/lib/billing/plan.ts` | The one plan. A credit is one cent at retail and is charged at twice the provider cost. |
| `src/lib/billing/ledger.ts` | Reserve, settle, grant, and expire. Each change is one conditional SQL statement. |
| `src/lib/billing/meter.ts` | `billingForSession`, `holdCredits`, `settleHold`. A missing hold does not silently spend the owner's key. |
| `src/lib/billing/stripe.ts` | Checkout, portal, and webhook signature checks over Stripe's REST API. |
| `src/lib/billing/webhook.ts` | `invoice.paid` grants the monthly allowance once per invoice. |
| `src/lib/billing/summary.ts` | The payload the billing page and the header badge read. |
| `src/lib/billing/hosted.ts` | Whether this process is on hosted Postgres. |

## Media

| File | What it does |
|---|---|
| `src/lib/media/generate.ts` | `runGeneration`: meter, call the adapter, store the bytes, record the asset. |
| `src/lib/media/campaign-poster.ts` | Renders the poster the campaign engine asks for. |
| `src/lib/media/prompts.ts` | Poster and video prompts from the brief and the creative. |
| `src/lib/media/catalog.ts` | Image and video models the settings page can pick. |
| `src/lib/media/adapters.ts` | Chooses a provider adapter. |
| `src/lib/media/providers/openai.ts` | GPT Image posters. Returns base64 bytes. |
| `src/lib/media/providers/google.ts` | Gemini image and video. |
| `src/lib/media/providers/bytedance.ts` | Seedream posters and Seedance video. |
| `src/lib/media/providers/alibaba.ts` | Qwen posters and Wan video. |
| `src/lib/media/providers/tencent.ts` | Hunyuan image and video, and Kling through TokenHub. |
| `src/lib/media/providers/http.ts` | Timeouts, polling, and capped downloads shared by those adapters. |
| `src/lib/media/providers/frame.ts` | Start-frame size for image-to-video. |
| `src/lib/media/providers/index.ts` | A provider is usable only when an adapter exists, a key is set, and the allow-list includes it. |
| `src/lib/media/store.ts` | Saves bytes and hands the campaign an `aisle-media:` url. |
| `src/lib/media/library.ts` | Account library queries. |
| `src/lib/media/client.ts` | Browser-side generate request. |
| `src/lib/media/stub.ts` | Placeholder render when no provider is configured. |
| `src/lib/media/production.ts` | One step of a story-ad job. |
| `src/lib/media/production-store.ts` | Queue for those jobs. Prompts from the browser are not stored here. |
| `src/lib/media/production-edit.ts` | Cuts and checks a finished story video. |
| `src/lib/media/storyboard.ts` | Scene timing. Creative text comes from the art director, not from this file. |
| `src/lib/media/progress.ts` | Render stages reported to the studio page. |
| `src/lib/media/art-direction.ts`, `art-director-system.ts` | Art-direction prompt and system text. |
| `src/lib/creatives.ts` | Builds the creative objects a campaign stores. |
| `services/media/worker.ts` | Process that drains the story-ad queue. |

`pr2-types.ts`, `pr2-fields.ts`, and `src/lib/pr2-shims.ts` are compatibility types so the media and billing modules line up with the catalogs the UI imports. UI code does not import the shim.

## Retail prices

| File | What it does |
|---|---|
| `src/lib/retail-data.ts` | Parse an uploaded retail file and match rows to a product. |
| `src/lib/retail/bundled.ts` | Small built-in catalogues used when no upload is connected. |
| `src/lib/retail/whichgrocer/oauth.ts` | Authorization-code plus PKCE against WhichGrocer. |
| `src/lib/retail/whichgrocer/connection.ts` | Stores the refresh token and looks up shelf prices for a signed-in user. |
| `src/lib/retail/whichgrocer/api.ts` | Catalogue HTTP API. The key stays on the server. |
| `src/lib/retail/whichgrocer/mcp.ts` | Remote MCP client for the same catalogue. |
| `src/lib/retail/whichgrocer/query.ts` | Turns a tool payload into one offer per retailer. No network. |
| `src/lib/retail/whichgrocer/clearance.ts` | Clearance price from the founder's cost and the cheapest comparable offer. |
| `src/lib/connections.ts` | Connection status and the device-key test used on the settings page. |

## Scripts

Suites run with `node --experimental-strip-types` through `scripts/service-loader.mjs`, which loads the same TypeScript modules the app uses. They use throwaway databases and fake provider servers. They do not write `data/aisle.db`.

| Script | What it checks |
|---|---|
| `bench-suite.ts` | Full campaign scenarios against `runEngine`, no browser. `npm run bench`. |
| `workflow-suite.ts` | Durable queue plus the inline trust boundary. |
| `workflow-browser-suite.ts` | Browser-shaped workflow calls. |
| `metering-suite.ts` | Credit holds, including a compliance call that sends poster images. |
| `billing-suite.ts` | Stripe checkout and webhooks against a fake Stripe. |
| `auth-suite.ts` | Signup, login, and the SQL account store. |
| `agents-suite.ts` | Seat tool-calling loop against a fake model. |
| `intake-suite.ts` | The intake assistant refuses invented fields and commands. |
| `compliance-suite.ts`, `compliance-rules-suite.ts`, `compliance-report-suite.ts` | Review outcome, policy registry, structured report. |
| `compliance-knowledge.ts`, `compliance-knowledge-suite.ts` | Build and query the compliance passage store. |
| `document-review-suite.ts` | Uploaded-document comparison. |
| `operation-graph-suite.ts`, `studio-graph-suite.ts` | The LangGraph drawing and one launch. |
| `resume-suite.ts` | A trend hand-off can continue, and a stale read does not rewind it. |
| `media-suite.ts`, `cloud-media-suite.ts`, `provider-adapters-suite.ts` | Generate path and the cloud adapters against fake servers. |
| `media-progress-suite.ts`, `media-timing-suite.ts`, `art-direction-suite.ts`, `story-ad-suite.ts` | Progress, timing, art direction, story editing. |
| `whichgrocer-suite.ts` | Shelf-price shaping and the disconnected path. |
| `trend-connection-suite.ts`, `trend-example.ts` | Trend source connection. `demo:trend` is the live example. |
| `backend-suite.ts` | Applying one backend preset to every slot. |
| `user.ts` | List accounts, set a password, add a user. |
| `stripe-setup.ts` | One-time Stripe product and price setup. |
| `provider-smoke.ts` | Live provider call. Spends real credit. Not part of the offline suites. |
| `dev-services.mjs` | Starts the local workflow and media processes for `npm run dev:services`. |
| `evaluate-local-workflow.ts` | Local workflow evaluation helper. |

## Other docs

| File | What it covers |
|---|---|
| `docs/STAGE2-IMPLEMENTATION.md` | Requirement to file to test. |
| `docs/SERVICE-WORKFLOW-AND-RUBRIC.md` | Durable worker and how it is marked. |
| `docs/contracts/campaign-context.md` | Shared campaign context contract. |
| `docs/contracts/compliance-review.md` | Compliance review contract. |
| `docs/LANGCHAIN-AGENTS.md` | How the seats are built. |
| `docs/TA-02-TREND-CONNECTION.md` | Trend connection setup. |
| `docs/RETAIL-DATA.md` | Retail upload. |
| `docs/compliance-document-review.md` | Document comparison. |
| `docs/compliance-knowledge/README.md` | Knowledge-pack layout. |
| `services/knowledge/law/AU/SOURCES.md` | Where the AU law texts came from. |
