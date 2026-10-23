# The agents, on LangGraph

Aisle's campaign bench is a LangGraph, and each seat inside it is a LangGraph
agent. This note explains what that means in this codebase, and the two places
where the framework is deliberately not in charge.

The operation graph is `src/lib/runtime/operation-graph.ts`. `runEngine` invokes
it once per command (`START`, `ADVANCE`, `APPROVE`, …). The nodes are the stages
the desk already had — intake, trend, creative, revise, compliance, media — and
the conditional edges are the old step pointer: a compliance failure goes to
revise, a founder gate stops the graph, the next command enters again. The
campaign document is still the record. The graph is how the run is traced and
drawn.

On a campaign's Runtime tab the same graph is drawn with the current step
highlighted, and the compiled Mermaid (what LangGraph itself emits) is under
"LangGraph definition".

## Tracing

LangGraph emits a trace for every invocation when LangSmith is turned on. The
Aisle account is in the Asia Pacific region, so the endpoint has to be the
APAC one. The US default rejects that key. Set these in `.env.local` and in
the Vercel project:

```
LANGSMITH_TRACING=true
LANGSMITH_ENDPOINT=https://apac.api.smith.langchain.com
LANGSMITH_API_KEY=
LANGSMITH_PROJECT=aisle
LANGSMITH_WORKSPACE_ID=
LANGCHAIN_CALLBACKS_BACKGROUND=false
```

`LANGSMITH_WORKSPACE_ID` is the id in the LangSmith URL (`/o/<workspace id>`).
A tracing-only key is org-owned, so the workspace id is required. Leave the
endpoint without a trailing slash. `LANGCHAIN_CALLBACKS_BACKGROUND=false`
makes Next.js send the trace before the response ends.

On a live server runtime the four Stage 1 services are the LangGraph seats.
`decideTrendBrief`, `decideCopy`, `decideCompliance` and `decideRecommendation`
ask `aisle_trend`, `aisle_creative`, `aisle_compliance` and `aisle_media`.
The orchestrator still collects authorised evidence, checks banned terms,
merges the deterministic compliance findings, and applies the answer. If the
seat cannot run, the one-shot model call and then the rules stand, which is
what the offline bench uses.

A launch then shows up as `aisle.operation.START` in the project named
`aisle`, with the seat agent (`aisle_trend`, `aisle_creative`, …) nested under
the node that called it. With the variables unset, nothing is sent and the
desk still draws the graph. The Workspace settings page in LangSmith does not
hold these values; it only switches the classic and new product experience.

## Studio

Studio only draws a graph that an Agent Server is serving. A trace written by
the Next.js process into the project named `aisle` has no graph, which is why
that project says Studio is not available.

With `npm run studio` running, a campaign launch from the desk is sent to that
server's **operation** graph instead of invoking the bench inside Next.js. The
thread is the graph you open in Studio, and the same run is the trace in
`aisle`. The Technical tab links straight to that thread. Set
`AISLE_GRAPH_URL=off` to keep the desk in-process. Production stays in-process
until `AISLE_GRAPH_URL` points at a deployed Agent Server.

`langgraph.json` registers the bench and the five seats. From the repo:

```
npm run studio
```

That starts the dev server on `http://127.0.0.1:2024` and opens Studio on the
host for `LANGSMITH_ENDPOINT` (APAC, for this account). The host is IPv4 on
purpose: on this machine `localhost` binds to IPv6 only, and Studio then
cannot reach it. If the browser opens the US host, stop it and run:

```
npx langgraphjs dev --host 127.0.0.1 --studio-url https://apac.smith.langchain.com
```

Pick **operation** for a campaign. The other graphs — **trend**, **creative**,
**compliance**, **media**, and **intake** — are the seats on their own. Open
the local server, not the tracing project: the project holds the trace, and
the server is what draws the graph.

**operation** is the campaign bench. The input is a campaign id (blank uses
`AISLE_STUDIO_CAMPAIGN_ID`, then the first draft) and a founder command
(`START`, `ADVANCE`, …). Hydrate loads that campaign from the workspace. The
same nodes the desk runs then execute, and the updated campaign is saved back.
`userId` blank uses `AISLE_STUDIO_USER_ID`, then the dev-alex desk.

The seat graphs are the `createAgent` graphs: their instructions, Zod answer,
call budget, and — for trend — the real tool registry. In graph mode the input
also has `campaignId`, `userId` and `modelId`. Blank means the same defaults as
the bench. A tool call is recorded on the campaign and the spend is added to
its meter. Chat mode uses those defaults. Threads and time travel are the dev
server's checkpointer (`.langgraph_api`, not committed).

The server may warn `Failed to get organization ID` while it is starting.
A tracing-only key cannot list sessions, so the Studio link has no
`organizationId`. Runs still trace when `LANGSMITH_WORKSPACE_ID` is set. You
are already in the `aisle` workspace; open the local server from there.

Safari blocks localhost. Use `npx langgraphjs dev --tunnel` and paste the
tunnel URL into Studio. Current Chrome also needs local-network access allowed
for `smith.langchain.com`, or the page fails with `Failed to fetch`.

`npm run test:studio` checks the drawing and one offline launch. It does not
call a model provider.

```
LangChain createAgent
  ├── instructions        lib/agents/seats.ts      role, rules, and the thing it may never do
  ├── tools               lib/agents/agent-tools.ts the registry, wrapped with Zod schemas
  ├── responseFormat      lib/agents/seats.ts       a Zod schema per seat
  └── middleware          lib/agents/seats.ts       the model-call budget
        │
        └── model         lib/agents/metered-chat-model.ts
              │
              └── _generate → runComplete()  ← every call: credit hold, settle, reroute, ledger
                                │
                                └── lib/llm/adapters.ts  OpenAI / Anthropic / local wire format
```

| File | What it is |
|---|---|
| [`metered-chat-model.ts`](../src/lib/agents/metered-chat-model.ts) | The bridge. A `BaseChatModel` whose `_generate` is the app's metered funnel |
| [`agent-tools.ts`](../src/lib/agents/agent-tools.ts) | The existing tool registry exposed to LangChain, unchanged in behaviour |
| [`seats.ts`](../src/lib/agents/seats.ts) | The four agents: instructions, schema, budget |
| [`agent-runtime.ts`](../src/lib/agents/agent-runtime.ts) | Run one seat, return a trace, fall back to rules on any failure |
| [`operation-graph.ts`](../src/lib/runtime/operation-graph.ts) | The bench as a LangGraph: one node per stage, one invocation per command |
| [`scripts/agents-suite.ts`](../scripts/agents-suite.ts) | Offline proof: tool calling, the budget, the fallback, seat isolation |

Run the proof with `npm run test:agents` — no keys, no credits, no network.

## Why the model is ours, not `@langchain/openai`

Every model call in Aisle goes through `runComplete`, because that is where the
credit hold is taken before a request leaves the server, where the provider's
reported usage is settled against the ledger, where an unconfigured or unaffordable
cloud seat is rerouted to a free local model, and where the run records which model
actually answered.

A LangChain provider package would make its own HTTP calls. It would bypass all of
it: money spent that nobody reserved, spend missing from the ledger, and a run trace
that names the seat instead of the model. So the agents run on
`MeteredChatModel`, and LangChain keeps everything above that line — the loop, tool
binding, structured output, message handling.

## The cost envelope, and why it is not negotiable

A credit hold reserves the **worst case for one call**. That is a safe design for a
sequence of bounded decisions and an unsafe one for an agent that loops until it
decides it is done, because N calls means N holds and the ceiling moves while you
are not looking.

So agent autonomy is real but bounded:

```ts
modelCallLimitMiddleware({ runLimit: MAX_MODEL_CALLS_PER_RUN, exitBehavior: "error" })
toolCallLimitMiddleware({ runLimit: MAX_MODEL_CALLS_PER_RUN * 2, exitBehavior: "error" })
```

The agent chooses *which* tools to call, in what order, and how many times, up to
the cap. The suite asserts this by driving a model that never stops asking for a
tool and checking the run is stopped at the ceiling rather than running away.

Raising `MAX_MODEL_CALLS_PER_RUN` raises the worst-case cost of one decision
proportionally, and that is the whole cost model: decisions × calls × cap.

## Two answer shapes, both accepted

A model that supports function calling answers by calling the structured-output
tool LangChain advertises for `responseFormat`, and the framework parses it.

A model that does not — a smaller local model, or an OpenAI model asked without
tool support — replies with the JSON as text instead. That is exactly how this
application worked before agents existed, so refusing that shape would silently
downgrade those runs to the rules. `seats.ts` accepts either and validates both
against the same Zod schema, so a text answer is held to the standard a tool call is.

## What the framework is not allowed to do

Three product guarantees stay outside the agent, in the engine:

- **The policy guard.** An agent cannot publish, overspend, change the campaign
  scope or alter cleared claims, whatever it decides. `runtime/guard.ts` refuses
  those actions and records the refusal, and the founder remains the only actor who
  may publish or approve.
- **The evidence ledger.** An agent's tool call goes through the engine's `callTool`,
  so it is recorded as a `ToolCall` against the campaign and raises its `Evidence`
  rows exactly as an engine-driven call does. AHR-02 is graded on that record.
- **The deterministic fallback.** No key, no credits, no local model, a refused
  call, a schema the model cannot satisfy, or a run that trips its budget: the seat
  returns null and the decision falls back to rules. The product works in a demo
  with nothing configured, and the run trace says which path ran.

## Adding a tool to a seat

Tools come from the existing registry, so there is one place to add one:

1. Add a `ToolDefinition` to `runtime/tools.ts` with `agent` set to the seat that
   may use it.
2. Nothing else. `agentTools()` builds its Zod schema from the declared `args`, and
   `toolArgHelp()` carries the description the model reads.

A seat can only ever see its own slice: the suite asserts the Media Manager
receives no research tools.
