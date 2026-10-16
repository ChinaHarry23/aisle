# Aisle: service workflow, evidence and assessment alignment

Reviewed and implemented on 29 September 2026. This is an evidence-based improvement towards a stronger submission, not a guarantee of an HD.

## What the supplied assessment material actually requires

- `../Brief/Stage1-Marking-Criteria.pdf`: one overall package diagram and one overall deployment diagram, both optional. The main marks are allocated to requirements, use cases and structural/behavioural models. Group and individual contributions must be identified.
- `../Brief/Project-Description.pdf`, Stage 2, page 2: a prototype aligned with Stage 1 requirements/models; meaningful LLM perception, decision-making and interaction; evidence of Agile practice; advanced technology. No HD-specific implementation grade descriptors were found in the supplied files.
- `../Brief/Project-Requirement-Example.pdf`: at least three distinct collaborating AI roles, one supervising founder, and individually attributable core/optional features. It is a domain example, not permission to change this project's retail requirements.
- Course notation: Week 7 Model Organisation and Tutorial 08 (package dependencies; deployment nodes, artifacts and communication paths).

## Implemented topology

`Browser -> Next.js web/API gateway -> Workflow HTTP API -> durable SQLite queue <- independent agent worker`

The worker runs the existing AHR-01 through AHR-06 engine and model/tool adapters. AHRs are use-case responsibilities, not automatically six independently deployable services. Keeping the four agent roles together behind a worker avoids inventing six network services just for a diagram.

There are three real operating-system processes in service mode:

| Process | Responsibility | Source |
| --- | --- | --- |
| Next.js web application | Founder UI, authentication, owner-scoped API gateway, job polling | `src/app/api/engine`, `src/lib/workflow/gateway.ts`, `src/app/operations` |
| Workflow API | Authenticated submissions, idempotency, transition validation, status, explicit retry | `services/workflow/api.ts`, `src/lib/workflow/commands.ts` |
| Agent worker | Queue claims, bounded steps, per-step checkpoints, approval gates, cooperative pause | `services/workflow/worker.ts` |

`services/workflow/repository.ts` owns `data/workflow.db`: jobs and authoritative campaign snapshots, SQLite WAL, atomic claims and per-workspace serialization. Existing account/workspace storage remains `data/aisle.db` or the already-supported PostgreSQL adapter. The workflow database is currently local SQLite only.

## Run locally

Use a recent Node.js release with built-in `node:sqlite` and TypeScript stripping (the bundled Node runtime used for verification supports both). Keep the existing `.env.local` authentication/provider settings; this change does not rewrite them.

```sh
npm run dev:services
```

Open `http://127.0.0.1:4003/operations`. The launcher starts the workflow API on loopback port 4171, the agent worker, and the web app. It generates the service secret in memory and shares it only with child processes. Override `AISLE_WEB_PORT` and `AISLE_WORKFLOW_PORT` if required. It does not stop other applications using a port.

Create a **new draft** to enter the durable workflow. Existing legacy campaign outputs are preserved and are not silently promoted to trusted service records. With `AISLE_WORKFLOW_URL` unset, `npm run dev` retains the existing inline mode; its browser-driven execution does **not** acquire the service mode's persistence guarantees.

For independent terminals, set the same `AISLE_WORKFLOW_SECRET` (32+ characters) on the web and workflow API, set `AISLE_WORKFLOW_URL`, and run `npm run workflow:api` plus `npm run workflow:worker`. Both service processes must use the same `AISLE_WORKFLOW_DB` path. Start the web application separately with the same gateway environment.

## Behaviour that is now demonstrated

- Commands become durable jobs before the worker executes them. Closing the browser does not stop the worker.
- A unique request key prevents duplicate submissions. Concurrent workers atomically claim jobs; campaigns in one workspace are serialized for scheduling consistency.
- The service reconstructs new drafts from permitted founder inputs. It does not trust browser-supplied approvals, logs, generated results or runtime state.
- Authenticated user identity is provided by the Next.js gateway. Jobs and snapshots are scoped to that user; an unrelated user receives 404.
- Each completed step saves an authoritative campaign checkpoint. Stale browser workspace saves cannot overwrite it.
- The worker stops at founder gates. Illegal approvals and agent-origin publish commands are refused. No real publishing connector is enabled.
- A pause waits for the current step to finish; it does not abort an already submitted model request.
- Expired worker leases become **interrupted**, not silently replayed. Explicit retry resumes from the last checkpoint. The UI warns that an external call may have completed before a crash; exactly-once provider effects are **not** claimed.
- Invalid briefs can be corrected and relaunched. AHR-06 missing-channel overrides remain explicit founder-controlled demonstration settings.

## Requirement and evidence map

| Requirement | Implementation/evidence | Remaining assessment work |
| --- | --- | --- |
| AHR-01 intake, context and controls | `intake.ts`; durable START/PAUSE; invalid-brief and correction tests; command trust boundary | Match final report wording and identify individual contribution |
| AHR-02 sourced trend analysis | `tools.ts`, `decideTrendBrief`; source/status ledger; unavailable-source behaviour | Evaluate relevance/quality on more than one campaign; synthetic retail signals must not be treated as measured evidence |
| AHR-03 generation | `runCreativeGeneration`, LLM gateway, ComfyUI adapter, version history | Verify actual media output separately; cloud media providers remain unwired |
| AHR-04 compliance and escalation | `runComplianceReview`, three-attempt regression scenarios, persisted founder gate | Document limitations of model/rule-based review; not a substitute for legal advice |
| AHR-05 distribution | Claim-preserving adaptation, conflict handling, guarded founder release | Release is simulated. A real channel connector requires credentials, explicit destination approval and an audited delivery receipt |
| AHR-06 feedback loop | Persistent reports, explicit gaps, accepted/edited/discarded recommendation tests | Channel figures are synthetic. Real analytics need measured/imported data or authorized provider connectors |
| LLM collaboration | Separate trend, creative, compliance and media roles; structured decision traces | Preserve a successful live local-model evaluation; deterministic tests alone do not prove live LLM behaviour |
| Reliability / advanced technology | Independent service/worker, durable queue, leases, idempotency, ownership checks, operations UI | Load/concurrency evaluation, monitoring and provider failure testing beyond this prototype |
| Agile practice | Concrete changes and automated acceptance tests from this work | Keep the team's real backlog, iterations, review evidence and retrospective; do not invent sprint history |
| Model consistency | Two code-aligned draw.io pages in `../Stage1/Diagrams/codex/architecture-diagrams` | Update related class/activity/interaction/report models and record actual authorship |

## Verification commands and observed results

Observed on 29 September 2026: **13 workflow checks passed**, **11 existing bench scenario groups passed**, and the isolated browser acceptance test passed. Type checking, repository lint and production build passed. The two draw.io pages were exported natively and visually checked. [Live local-model evidence](evidence/local-evaluation-2026-09-29.json) records three successful role decisions (trend, creative, compliance), a persisted founder gate and a 115-second run. This was one synthetic text-agent evaluation with poster output stubbed, not a measured production/quality benchmark.

```sh
npm run test:workflow
npm run bench
npm run typecheck
npm run lint
npm run build
```

The workflow suite uses temporary databases and offline model/media fixtures. It includes real HTTP requests and separately spawned worker processes. It tests enqueue/reopen, duplicate commands, two-worker claiming, tenant isolation, approval gates, release/feedback persistence, expired leases, explicit retry, pause/resume, corrected briefs and missing-channel handling.

`scripts/workflow-browser-suite.ts` starts an isolated web app and workflow API with throwaway account/workflow databases, uses an independent fixture worker, closes the browser before work executes, then verifies the reopened operations page. It also checks stale-save protection, forged actor denial and cross-user access. Desktop and mobile screenshots are rendered and inspected. Its configured test ports are 4183 and 4171; do not run it when those ports are occupied. Set `PLAYWRIGHT_MODULE` and `CHROME_PATH` for your installed browser tooling.

`scripts/evaluate-local-workflow.ts` is a separate, opt-in **live local-text-model** evaluation. It only accepts a loopback model URL, uses a synthetic retail brief, disables internal retail data, and deliberately stubs poster generation. It requires at least three successful live-decision records before passing. It does not prove live image/video generation, real publishing, production reliability or commercial effectiveness.

## Boundaries before claiming a finished production or HD-level submission

1. Obtain the detailed Stage 2 marking bands if the course provides them. The available Stage 1 rubric and Stage 2 brief do not specify an HD threshold.
2. Capture repeatable, quality-assessed live agent runs and actual media generation, with provider/model, prompt, inputs, outputs, errors and evaluation criteria.
3. Replace simulated release/analytics with at least one authorized end-to-end connector, if required by the agreed project scope. Never claim the current generated figures are real results.
4. Complete report/model consistency and individual contribution evidence. Neither extra services nor optional diagrams compensate for missing assessed models.
5. This is a local service topology. It is not a cloud deployment: shared SQLite cannot be spread across independent serverless instances. Network queue/storage, HTTPS, secrets management, restrictive egress, production account hardening, back-ups and load tests are further work.
6. The service is authoritative for pipeline-generated creatives and approval state. Legacy browser-only manual studio edits are not automatically accepted into managed campaign snapshots; use the pipeline for managed campaign revisions. A future trusted studio-generation command is needed before claiming complete feature parity in service mode.

No existing user data, account database, credentials or unrelated working-tree changes were intentionally removed. No external posts, paid advertisements or cloud deployment were made by this change.
