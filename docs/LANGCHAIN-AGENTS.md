# The agents, on LangChain

Aisle's four agent seats run as LangChain ReAct agents. This note explains what
that means in this codebase, and the two places where the framework is deliberately
not in charge.

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
