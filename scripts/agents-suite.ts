/**
 * Offline checks for the LangChain agents.
 *
 * No live models, no keys, no credits spent. A fake OpenAI-compatible server stands
 * in for the provider so the whole tool-calling loop can be driven deterministically:
 * the scripted server asks for a tool, then answers with structured output, and the
 * test asserts what actually crossed the wire.
 *
 *   npm run test:agents
 */

import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { MeteredChatModel, MeteredCallUnavailable, toTurns, MAX_MODEL_CALLS_PER_RUN } from "../src/lib/agents/metered-chat-model";
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";
import { agentTools, toolNamesFor, toolSchema } from "../src/lib/agents/agent-tools";
import { buildAgent, complianceSchema } from "../src/lib/agents/seats";
import { runComplete } from "../src/lib/llm/metered-complete";
import { getLlmModel } from "../src/lib/llm/catalog";
import { parseToolArgs, LOCAL_DEFAULT_LLM } from "../src/lib/pr2-shims";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { TOOL_REGISTRY } from "../src/lib/runtime/tools";

// Isolate offline tests from any local LLM server running on standard ports.
process.env.LOCAL_LLM_PROBE_URLS = "";

let checks = 0;
const pass = (label: string) => {
  checks++;
  console.log(`PASS ${label}`);
};

/* ------------------------------------------------------- wire translation --- */

{
  const turns = toTurns([
    new SystemMessage("You are the Compliance Checker."),
    new HumanMessage("Review this."),
    new AIMessage({ content: "", tool_calls: [{ name: "check.rule", args: { id: 1 }, id: "call_9" }] }),
    new ToolMessage({ content: '{"status":"ok"}', tool_call_id: "call_9", name: "check.rule" }),
    new HumanMessage("Now answer."),
  ]);
  assert.equal(turns.system, "You are the Compliance Checker.", "the system prompt becomes its own field");
  assert.equal(turns.prompt, "Now answer.", "the last human turn is the prompt");
  assert.equal(turns.turns.length, 3, "everything before it is history");
  assert.deepEqual(
    turns.turns[1],
    { role: "assistant", content: "", toolCalls: [{ id: "call_9", name: "check.rule", args: { id: 1 } }] },
  );
  assert.deepEqual(turns.turns[2], {
    role: "tool",
    toolCallId: "call_9",
    name: "check.rule",
    content: '{"status":"ok"}',
  });
  pass("a LangChain conversation translates to portable turns, keeping tool-call ids paired");
}

{
  // createAgent stores systemPrompt as a SystemMessage with array content, not a string.
  const turns = toTurns([
    new SystemMessage({ content: [{ type: "text", text: "You may NEVER approve an advertisement." }] }),
    new HumanMessage("Review this."),
  ]);
  assert.match(turns.system, /never approve/i, "array-content system prompts still become the system field");
  assert.equal(turns.prompt, "Review this.");
  pass("LangChain 1.x array-content system prompts are sent as the seat instructions");
}

{
  // A provider that returns junk arguments must not look like a call with none.
  assert.deepEqual(parseToolArgs('{"a":1}'), { a: 1 });
  assert.deepEqual(parseToolArgs(""), {});
  assert.deepEqual(parseToolArgs("not json"), { __unparsed: "not json" });
  assert.deepEqual(parseToolArgs("[1,2]"), { __unparsed: "[1,2]" });
  pass("malformed tool arguments are surfaced, never silently treated as empty");
}

/* ------------------------------------------------------------- tool specs --- */

{
  for (const definition of TOOL_REGISTRY) {
    const schema = toolSchema(definition) as unknown as {
      shape?: Record<string, unknown>;
      _def?: { shape?: Record<string, unknown> };
    };
    const shape = schema.shape ?? schema._def?.shape ?? {};
    assert.deepEqual(
      Object.keys(shape).sort(),
      [...definition.args].sort(),
      `${definition.name} exposes exactly its declared arguments`,
    );
  }
  const trendTools = toolNamesFor("trend");
  assert(trendTools.length >= 4, "the Trend Analyser gets the research tools");
  assert(!trendTools.includes("anything-else"));
  pass(`every registry tool exposes a schema matching its declared arguments (${TOOL_REGISTRY.length} tools)`);
}

/* ---------------------------------------------------- the loop, end to end --- */

/** Responses are served in order, so a test can script a whole conversation. */
type Scripted = (body: Record<string, unknown>, call: number) => Record<string, unknown>;
const seen: { path?: string; body?: Record<string, unknown> }[] = [];
let scripted: Scripted = () => ({});
let calls = 0;

const fake = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString();
  const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  seen.push({ path: req.url, body });
  res.setHeader("content-type", "application/json");
  if (req.url === "/v1/models") {
    return res.end(JSON.stringify({ data: [{ id: "mtplx-flash-next-optimized-speed" }] }));
  }
  if (req.url === "/v1/chat/completions") {
    calls++;
    return res.end(JSON.stringify(scripted(body, calls)));
  }
  res.statusCode = 404;
  res.end("{}");
});
fake.listen(0, "127.0.0.1");
await once(fake, "listening");
const address = fake.address();
assert(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/v1`;

const wiring = {
  agent: "compliance" as const,
  modelId: LOCAL_DEFAULT_LLM,
  billing: undefined,
  localBaseUrl: base,
  localModel: getLlmModel(LOCAL_DEFAULT_LLM).apiModel,
  complete: runComplete,
};

try {
  /* --- 1. tools are advertised, the model calls one, the answer is structured --- */
  const executed: string[] = [];
  const fakeTool = new DynamicStructuredTool({
    name: "policy.lookup",
    description: "Look up an advertising rule for a country.",
    schema: z.object({ country: z.string().describe("Two-letter market code.") }),
    func: async (args: { country: string }) => {
      executed.push(args.country);
      return JSON.stringify({ rule: `No absolute superiority claims in ${args.country}.` });
    },
  });

  const complied = JSON.stringify({
    issues: [
      {
        category: "unsupported_claim",
        basis: "confirmed_breach",
        severity: "high",
        excerpt: "the warmest jacket in Australia",
        explanation: "Absolute comparative claim with no substantiation.",
        rule: "ACL s18",
        recommendedCorrection: "Replace with a verifiable product fact.",
      },
    ],
    summary: "One confirmed breach.",
  });

  scripted = (body, call) => {
    if (call === 1) {
      return {
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                { id: "call_a", function: { name: "policy.lookup", arguments: '{"country":"AU"}' } },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 10 },
      };
    }
    // A real function-calling model answers by calling the structured-output tool
    // the agent advertised, not by returning loose JSON in a text block. The tool
    // is named per request, so read it back off the request the agent sent.
    const offered = ((body.tools ?? []) as { function?: { name?: string } }[])
      .map((t) => t.function?.name)
      .filter((name): name is string => Boolean(name));
    const extract = offered.find((name) => name !== "policy.lookup") ?? "extract";
    return {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [{ id: "call_b", function: { name: extract, arguments: complied } }],
          },
        },
      ],
      usage: { prompt_tokens: 80, completion_tokens: 40 },
    };
  };

  const agent = buildAgent({
    seat: "compliance",
    model: wiring,
    tools: [fakeTool],
    schema: complianceSchema,
  });
  const answer = await agent.invoke({ task: "Review this advertisement." });

  assert.deepEqual(executed, ["AU"], "the agent actually ran the tool it asked for");
  assert.equal(answer.issues.length, 1, "the structured answer is parsed");
  assert.equal(answer.issues[0].basis, "confirmed_breach");
  assert.equal(calls, 2, "one tool call, then one answer");

  const first = seen.find((row) => row.path === "/v1/chat/completions");
  const sentTools = first?.body?.tools as { function?: { name?: string } }[] | undefined;
  const offered = (sentTools ?? []).map((t) => t.function?.name).filter(Boolean) as string[];
  assert(offered.includes("policy.lookup"), "the seat's own tool crosses the wire");
  assert.equal(offered.length, 2, "the structured-output tool is offered alongside it");
  const structured = sentTools?.find((t) => t.function?.name !== "policy.lookup");
  assert.equal(
    (structured?.function as { parameters?: { type?: string } } | undefined)?.parameters?.type,
    "object",
    "its JSON Schema survives translation, with no $schema a provider would reject",
  );
  const sentMessages = first?.body?.messages as Record<string, unknown>[] | undefined;
  assert.equal(sentMessages?.[0]?.role, "system", "the seat's instructions are sent as a system message");
  assert.match(String(sentMessages?.[0]?.content), /never approve/i, "and they carry the compliance rule");

  // The tool result must come back paired to the call it answers.
  const second = seen.filter((row) => row.path === "/v1/chat/completions")[1];
  const followUp = second?.body?.messages as Record<string, unknown>[] | undefined;
  const toolMessage = followUp?.find((m) => m.role === "tool");
  assert.equal(toolMessage?.tool_call_id, "call_a", "the result is paired to the request");
  assert.match(String(toolMessage?.content), /No absolute superiority/, "and carries what the tool returned");
  pass("an agent calls a tool, the result returns paired, and the structured answer parses");
  pass("the seat's own instructions and tools are what cross the wire");

  /* ----------------------------------------------------- the run is bounded --- */

  calls = 0;
  // A model that never stops asking for tools: without a cap this runs forever.
  scripted = () => ({
    choices: [
      {
        message: {
          content: "",
          tool_calls: [{ id: `call_${calls}`, function: { name: "policy.lookup", arguments: '{"country":"AU"}' } }],
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });

  const looping = buildAgent({
    seat: "compliance",
    model: wiring,
    tools: [
      new DynamicStructuredTool({
        name: "policy.lookup",
        description: "Look up an advertising rule.",
        schema: z.object({ country: z.string() }),
        func: async () => JSON.stringify({ rule: "ok" }),
      }),
    ],
    schema: complianceSchema,
  });

  let failed = false;
  try {
    await looping.invoke({ task: "Review this." });
  } catch {
    failed = true;
  }
  assert(failed, "an agent that never stops is stopped by the middleware");
  assert(
    calls <= MAX_MODEL_CALLS_PER_RUN,
    `the cap held: ${calls} model calls, ceiling ${MAX_MODEL_CALLS_PER_RUN}`,
  );
  pass(`a runaway agent is bounded at ${calls} model calls (ceiling ${MAX_MODEL_CALLS_PER_RUN}, one credit hold each)`);

  /* ------------------------------------------------- a seat that cannot pay --- */

  // No credits and no local model: the funnel refuses before any request goes out.
  const unreserved: typeof wiring = {
    ...wiring,
    modelId: "openai:gpt-6.1-sol",
    billing: undefined,
    localBaseUrl: "http://127.0.0.1:1/v1",
  };
  const refused = new MeteredChatModel(unreserved);
  let threw: MeteredCallUnavailable | null = null;
  try {
    await refused.invoke([new HumanMessage("Review this.")]);
  } catch (error) {
    threw = error instanceof MeteredCallUnavailable ? error : null;
  }
  assert(threw, "a seat that cannot answer raises rather than returning an empty completion");
  assert(
    ["unconfigured", "no_credits", "error"].includes(threw!.result.status),
    `the reason is carried through: ${threw!.result.status}`,
  );
  assert.match(threw!.message, /\S/, "and it says why, for the run trace");
  pass("a seat with no keys, no credits and no local model fails loudly, so rules take over");

  /* ---------------------------------------------------------- seat isolation --- */

  const context = {
    campaign: { id: "cmp_test", channels: [], sharedContext: {} } as never,
    brand: { retailerName: "Lane & Co." } as never,
    at: new Date().toISOString(),
    execute: async () => ({ summary: "not run", status: "ok" as const, evidence: [], data: null }),
  };
  const trendNames = agentTools("trend", context).map((t) => t.name);
  const mediaNames = agentTools("media", context).map((t) => t.name);
  assert(mediaNames.length === 0, "the Media Manager has no research tools of its own");
  assert(trendNames.every((name) => TOOL_REGISTRY.some((d) => d.name === name)));
  assert(
    trendNames.every((name) => !mediaNames.includes(name)),
    "no seat gets another seat's tools",
  );
  pass(`each seat only receives its own tools (trend: ${trendNames.length}, media: ${mediaNames.length})`);

  const traced = new MeteredChatModel({
    agent: "compliance",
    modelId: "openai:gpt-6.1-sol",
    billing: undefined,
    complete: async () => ({
      provider: "OpenAI",
      providerId: "openai",
      modelId: "openai:gpt-6.1-sol",
      modelName: "GPT-6.1 Sol",
      status: "ok",
      text: "ok",
      note: "test",
      at: "2026-10-18T00:00:00.000Z",
      usage: {
        inputTokens: 3544,
        outputTokens: 1052,
        totalTokens: 4596,
        costUsd: 0.01761,
        billedAs: "test",
        estimate: false,
        latencyMs: 1,
      },
    }),
  });
  const reported = await traced.invoke([new HumanMessage("Review this.")]);
  assert.equal(reported.usage_metadata?.input_tokens, 3544);
  assert.equal(reported.usage_metadata?.output_tokens, 1052);
  assert.equal(reported.usage_metadata?.total_tokens, 4596);
  assert.equal((reported.usage_metadata as { total_cost?: number } | undefined)?.total_cost, 0.01761);
  const ls = traced.getLsParams({});
  assert.equal(ls.ls_model_name, "gpt-6.1-sol");
  assert.equal(ls.ls_provider, "openai");
  const run = { outputs: { generations: [[{ message: reported }]] }, extra: {} as { metadata?: { usage_metadata?: { input_tokens?: number; total_cost?: number } } } };
  new LangChainTracer().onLLMEnd(run as never);
  assert.equal(run.extra.metadata?.usage_metadata?.input_tokens, 3544);
  assert.equal(run.extra.metadata?.usage_metadata?.total_cost, 0.01761);
  pass("agent model reports LangSmith usage_metadata and the model name");
} finally {
  fake.close();
  await once(fake, "close");
}

console.log(`\n${checks} checks passed.\n`);
