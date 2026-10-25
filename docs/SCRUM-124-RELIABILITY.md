# SCRUM-124 implementation and verification

Scope agreed with Danting on 25 October 2026: finish the reliability, evidence,
usage-accounting, tool-test and tracing items identified in the Jira scope review.
Branch: `codex/scrum124-research-reliability`, based on TA-05 commit `15da5f9`.
No automatic push, merge, deployment, Jira status change or hosted acceptance claim.

## Implemented

- Public WhichGrocer/Firecrawl/SerpApi result cache: process-local, 1-hour maximum
  TTL, 128 entries and 100 KB maximum outcome. Disabled with
  `TREND_PUBLIC_CACHE_TTL_MS=0`. Keys hash the provider account credential and
  validated public product/category/country/date/channel/tool scope. Neither keys
  nor values contain billing identities, credentials, uploaded POS rows or notes.
  Cache reuse rechecks permission, schema, allowlist, credentials and product-ID
  provenance. Evidence IDs are new for each run, while information and fetch dates
  remain the original dates. Cached source support is reassessed by TA-04/05.
- Cache hits bypass new provider billing reservations in collection and targeted
  quality replacement. Current credits/cost are zero; original reported credits
  and original fetch date remain visible. Same-run duplicate calls are also free.
  Existing time, permission, pause and tool-call gates still run before cache reuse.
- Provider usage on ToolCall is separate from evidence: actual nonnegative numeric
  Firecrawl `creditsUsed` (including data/metadata forms) and WhichGrocer
  `meta.credits_charged` are recorded. Catalogue search and equivalents credits are
  accumulated. Missing, malformed or unavailable reported usage stays null/unknown;
  it is never inferred from a tariff. Conservative USD reservations remain
  explicitly estimates and are not replaced by unverified currency conversions.
- Catalogue data preserves pack/unit fields and 30-day statistics. Records with
  unknown/future dates, archive/stale markers, or age over seven calendar days
  cannot support current prices. Cached records age on reuse; stale shelf offers
  are excluded from clearance recommendation inputs. A below-average price is
  explicitly not a verified retailer promotion; unknown offer windows stay unknown.
- The legacy deterministic path no longer calls DuckDuckGo Instant Answer. The
  isolated compatibility adapter remains available for historical tests; the normal
  agent already uses scoped search and original-source reading. Failed research
  retains evidence/gaps and does not silently rerun the retired pipeline.
- A server-only `traceConfig` option permits controlled tracing of the existing
  operation graph; no client-supplied callback configuration is accepted by routes.
  Local callbacks verify the actual LangGraph START -> trend -> aisle_trend
  ancestry. This local check uses a mock model and is not hosted acceptance.

## Verification

- `npm run test:research-reliability -- --record`: 16 groups. Each of the eight
  research adapters plus shelf prices and forecast weather has success, HTTP
  error, timeout, malformed/empty response and permission tests. Missing-key cases
  apply to authenticated services; public scraping retains a supported direct-read
  alternative. HTTP tests use injected fetch only, never live network.
- Cache tests cover account/scope separation, credential removal, permission denial,
  expiry, immutable provenance, new run IDs, zero current credits and ageing prices.
- Actual shared executor and middleware tests cover preliminary-collection limits,
  over-cap tool batches and the six-model-turn / twelve-agent-tool ceilings.
  Existing tests cover dedupe, pause, shared credit denial and recovery.
- Regression checks: research 15, quality 15, evidence 11, brief 14, WhichGrocer 13,
  graph 2 and bench 15 scenario groups. TypeScript and targeted ESLint checked.
- `docs/SCRUM-124-TEST-SUMMARY.json` stores synthetic matrix/local ancestry records.

## Hosted LangSmith acceptance remains pending

No LANGSMITH_API_KEY/LANGCHAIN_API_KEY or project configuration was present in
local `.env.local`. Danting is checking the team's existing project. No account
was created and no subscription is needed for local functionality.

`npm run verify:research-trace -- --check` performs configuration inspection only
and prints no credential. With the existing team's configuration and an explicitly
selected existing local billing identity, the opt-in command is:

```sh
npm run verify:research-trace -- --live --user <existing-local-user-id>
```

This command uses a synthetic AU apple-juice campaign, the configured real model
and real public tools; it can incur metered inference/search costs within existing
campaign/research budgets. It never generates or publishes ads. Global SDK flags
and a Client configured with hidden inputs/outputs prevent raw graph state,
credentials, uploads, prompts and HTTP bodies from being sent. Only a public
citation/tool audit and acceptance booleans are attached as root metadata. It reads
back the hosted trace, checks parent/child ancestry and two successful cited tool
types, and writes `docs/SCRUM-124-HOSTED-TRACE.json` only after the remote run.
No hosted result is currently present or claimed.

## Intentional scope and limits

Mandatory research coverage remains; 32 tool attempts is a ceiling, not a target.
Agent and model middleware plus shared stage budgets also apply. Existing failed
sources remain explicit gaps. No mandatory weather call, general location selector,
long-range forecast substitution, biggest-savings feature, paid-service purchase,
registry renaming or deletion of the isolated TA-02 baseline was added.

Cache reuse is within the lifetime of one server/worker process. It is not a
shared distributed cache; cold starts or separate workers can make independent
calls. Provider costs on failed calls can be unknown and are conservatively
reserved. Authenticated Firecrawl/WhichGrocer/SerpApi live success remains unverified
without those credentials; mocks are labelled accordingly.

Implementation references checked against the installed LangSmith SDK and primary
provider sources: [LangSmith Client](https://reference.langchain.com/javascript/langsmith/client/Client),
[Firecrawl HTTP creditsUsed report](https://github.com/firecrawl/firecrawl/issues/3351),
[WhichGrocer attribution/terms](https://www.whichgrocer.com/developers/terms).
