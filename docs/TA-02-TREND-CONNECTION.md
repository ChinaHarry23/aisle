# TA-02 Trend LLM connection

## Status and scope

Implemented on top of GitHub main `b2ac06b42812d2a14e00e639a4fc8ae7f81547ce`.
One real synthetic-input call to the existing default model `openai:gpt-6-luna`
passed on 18 October 2026. See the sanitised evidence record below. This confirms
the decision connection, not the accuracy of market research or a deployed website.
No remote branch, PR, deployment or Jira status was changed.

The earlier campus-proxy experiment is NOT included in this branch. No new model,
provider SDK or research connector is added. The upstream WhichGrocer integration,
owner identity and source-gap handling are retained.

## Architecture

The existing operation graph runs `runTrendResearch`, collects evidence and calls
`decideTrendBrief`. The new `createTrendAgentRuntime` implements the existing
`LlmRuntime` interface and connects this decision to the shared `buildAgent`,
`trendBriefSchema`, `MeteredChatModel` and metered completion adapter.

The bounded agent consumes collected evidence. It gets no research tools or
publishing tools and cannot mutate the original campaign. Structured output and
JSON-text output are both schema validated. One decision permits one completion
attempt, with an output cap of 1600 tokens. The shared OpenAI transport now forwards
this cap as `max_completion_tokens` for Chat or `max_output_tokens` for Responses.
Other callers that omit the cap retain their previous request shape.

Unknown models fail explicitly. Invalid output, transport failure and unavailable
configuration use the existing clearly labelled deterministic fallback. A reroute
cannot be accepted as success from the originally selected model. Incurred usage
is retained if a successful provider response fails subsequent schema validation.
Injected test completions require mock mode and cannot produce a live-model trace.

Trend parsing also preserves low confidence scores and empty claims arrays. It
no longer raises confidence to 40 or fills an intentionally empty allowed-claims
list from the fallback. The campaign budget is included in the decision prompt.
These checks enforce structure and provenance labels, not factual correctness of
every model-generated statement. Human review and evidence checks remain required.

## Server enablement

`TA02_AGENT_ENABLED=1` opts the website engine route and workflow worker into the
new runtime. It defaults to off. Configure the flag on both processes if using
durable workflows. No flag was enabled in a deployment during this task.

- The route resolves billing from the signed-in user's current database record.
- The worker resolves the job owner's current database role at each step.
- Cloud calls require a user billing context and the existing credit authorisation.
- The hook rejects unmetered contexts and unsupported providers.
- Model selection comes from stored workspace settings, not browser request settings.
- `TA02_MODEL_ID` selects only the standalone CLI model.
- Non-Trend decisions retain their previous runtime behaviour.
- Existing worker test injection remains available.

This snapshot supports local and OpenAI through the shared agent transport.
Anthropic tool calling is not wired there. BytePlus media credentials do not
configure a Trend text model. The server modules must not be imported into client
components because billing imports server-side database code.

After deployment review, use a synthetic campaign to check both inline and worker
modes, the `live_model` trace, selected model and billing record. Turn the flag off
to roll back the integration without rewriting saved campaigns. An authenticated
browser/worker live-provider end-to-end acceptance has not yet been performed.

## Reproduce offline checks

Node 24.13.0 was used with the committed lockfile.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run test:trend-connection
npm run test:whichgrocer
npm run test:agents
npm run test:workflow
npm run demo:trend -- --mock
npx next typegen
npm run typecheck
```

The Trend suite has 18 checks, including mocked OpenAI request shapes, a fake
loopback HTTP provider, the operation graph, schema failures, output caps,
identity guards and truthful fallback labels. Loopback tests require permission
to listen on localhost. They are OFFLINE evidence, not real model evidence.

## Real-provider smoke test

Keep keys only in a private environment file, never source control or chat.
The test used an external environment file without copying it into the repository.
Set `TA02_MODEL_ID` to an approved existing catalog ID. The repository default used
for acceptance was `openai:gpt-6-luna`.

With an ignored `.env.local`:

```sh
npm run demo:trend -- --live --allow-paid
```

Or load a private environment file directly:

```sh
TA02_MODEL_ID=openai:gpt-6-luna LANGSMITH_TRACING=false LANGCHAIN_TRACING_V2=false \
node --env-file=/absolute/path/to/private/env.local \
  --import ./scripts/service-loader.mjs --experimental-strip-types \
  scripts/trend-example.ts --live --allow-paid
```

The explicit paid flag permits provider charges. This owner-run CLI uses an
unmetered application billing context, which does NOT mean the provider is free.
Never use that context in a public route. Only a synthetic campaign and one
explicitly synthetic evidence line are sent. No retailer records are included.
External tracing was disabled for the acceptance call.

The CLI exits unsuccessfully on a fallback, invalid response, different model or
missing configuration. A mock demo is explicitly labelled MOCK ONLY.

## Recorded acceptance evidence

Recorded 2026-10-18 at 16:17 AEDT after the call completed. No key or raw provider
error response is included.

| Field | Observed result |
| --- | --- |
| Command | External-env live smoke command above |
| Process exit | 0 |
| Mode | LIVE |
| Model | openai:gpt-6-luna |
| Status / decision path | ok / live_model |
| Original campaign unchanged | true |
| Input / output / total tokens | 636 / 312 / 948 |
| Provider-call latency | 5259 ms |
| Cost computed from project catalog | US$0.00022, not an invoice verification |
| Evidence scope | Synthetic oat-snack campaign, not market-trend evidence |

The response allowed the supplied product fact and identified missing research,
performance and product-detail evidence. This is connection evidence only.
The initial sandboxed attempt failed before a successful live result; a permitted
network retry produced the result above. No repeated successful calls were made.

Offline results: Trend 18/18, WhichGrocer 6/6, shared agents 9/9, workflow 13/13.
Mock demo, targeted ESLint and TypeScript checks passed before final documentation.
Default Turbopack build was blocked by environment font/network and then port
restrictions. A Webpack production build was used as a separate verification path;
`npm run build -- --webpack` passed with exit code 0. It reported an existing
`unpdf` import.meta warning and the parent lockfile/root warning. No build
configuration was changed to bypass the default Turbopack environment restriction.

## Team update draft

TA-02 is implemented against the latest main snapshot. The Trend decision now
uses our shared agent builder and metered LLM adapter. I verified one real call
with the repository's default text model, GPT-6 Luna, using synthetic input.
The structured result passed validation and the campaign input was unchanged.
The existing WhichGrocer integration is preserved. The web and worker hooks are
behind a default-off flag, so production activation and end-to-end deployment
checks still need review. No credentials are included in the code.
