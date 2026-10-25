/**
 * The bridge between LangChain and this app's model plumbing.
 *
 * Every model call in Aisle goes through `runComplete` for a reason: it holds the
 * worst-case cost in credits before the request leaves the server, settles what the
 * provider reports, reroutes to a free local model when the cloud seat is
 * unconfigured or unaffordable, and records which model actually answered. A
 * LangChain agent must not bypass that — a framework that quietly made its own
 * HTTP calls would spend money nobody reserved and disappear from the ledger.
 *
 * So rather than use `@langchain/openai`, the agents run on this chat model: a
 * `BaseChatModel` whose `_generate` is `runComplete`. LangChain keeps its agent
 * loop, tool binding and structured output; billing, credit holds, local rerouting
 * and the run trace stay exactly where they were.
 */

import { BaseChatModel, type LangSmithParams } from "@langchain/core/language_models/chat_models";
import { AIMessage, ToolMessage, type BaseMessage, type UsageMetadata } from "@langchain/core/messages";
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";
import { z } from "zod";
import type { ChatGeneration, ChatResult } from "@langchain/core/outputs";
import type { Runnable } from "@langchain/core/runnables";
import type { BillingContext } from "@/lib/billing/meter";
import { getLlmOrDefault } from "@/lib/llm/catalog";
import { langsmithUsage } from "@/lib/llm/estimate";
import type { ChatTurn, CompleteRequest, CompleteResult, MeteredAgentId, ToolCall, ToolSpec } from "@/lib/llm/types";

/** Running total of everything one agent run has spent. */
export type UsageMeter = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  /** How many provider round-trips the run took. */
  calls: number;
  /** Every model that actually answered, so a local reroute is visible. */
  models: string[];
  /** The last thing the funnel said, shown in the run trace. */
  lastNote: string;
};

/** Where a seat's calls go. The engine resolves this from workspace settings. */
export type MeteredModelConfig = {
  agent: MeteredAgentId;
  modelId: string;
  billing: BillingContext | undefined;
  localBaseUrl?: string;
  localModel?: string;
  /** Output allowance per model call, passed through to the funnel. */
  maxOutputTokens?: number;
  /**
   * Runs one completion. Injected so the model is testable without a network and
   * so a caller can supply the same funnel the rest of the app uses.
   */
  complete: (req: CompleteRequest, billing: BillingContext | undefined) => Promise<CompleteResult>;
  /**
   * Called before each model turn with the shape of the conversation.
   *
   * An agent's turns are otherwise invisible: the funnel logs one call at a time
   * and the framework holds the message history, so nothing else can say how many
   * turns a decision took or whether the tool results were carried forward.
   */
  onTurn?: (turn: {
    index: number;
    messages: number;
    history: number;
    tools: number;
    types: string[];
  }) => void;
};

/**
 * Flatten LangChain messages into the provider-neutral turns the adapters speak.
 *
 * Two details matter for tool calling to work at all. The first message is the
 * system prompt, which is part of the request rather than the history, because
 * every provider carries it in its own field. And a `ToolMessage` has to keep the
 * `tool_call_id` of the request it answers: without that pairing, OpenAI and
 * Anthropic both reject the turn.
 */
/**
 * The system prompt, the conversation before the current turn, and the current turn.
 *
 * The current turn is returned as the prompt regardless of whether it is a user
 * message or a tool result, because both are legal final turns in a tool-calling
 * loop and the adapters place it accordingly.
 */
export type FramedConversation = {
  system: string;
  turns: ChatTurn[];
  prompt: string;
  /** The final turn is a tool result, so the provider needs it placed as one. */
  lastTurnIsToolResult?: boolean;
  /** The call that result answers. */
  toolCallId?: string;
};

/** LangChain 1.x stores `systemPrompt` as a SystemMessage with array content. */
function messageText(message: BaseMessage): string {
  const fromGetter = message.text;
  if (typeof fromGetter === "string" && fromGetter) return fromGetter;
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .filter(Boolean)
    .join("");
}

export function toTurns(messages: BaseMessage[]): FramedConversation {
  const system = messages
    .filter((message) => message.getType() === "system")
    .map(messageText)
    .filter(Boolean)
    .join("\n\n");

  // The model gets the whole conversation, ending with the turn it must answer.
  //
  // This is the subtle part of a tool-calling loop. On the first turn the last
  // message is the user's; on a tool turn it is the *tool result*, and the
  // provider requires that result to come back as a tool message paired to the
  // call that asked for it. Treating "the current turn" as "the last user message"
  // therefore throws away exactly the exchange the model is waiting on — it
  // re-asks the original question and ignores its own tool call. So the final
  // message is sent in the shape it arrives in, and everything before it is history.
  if (messages.length === 0) return { system, turns: [], prompt: system };

  const final = messages[messages.length - 1];
  const finalText = messageText(final);
  if (final.getType() === "system") {
    // Nothing but instructions: a prompt is still required, so repeat the system text.
    return { system, turns: [], prompt: system };
  }

  const history = toTurnsForHistory(messages.slice(0, -1));
  if (final.getType() === "tool") {
    const tool = final as ToolMessage;
    // A tool result must go back as a tool result, paired to the call it answers:
    // OpenAI and Anthropic both reject a conversation that answers a tool call
    // with a plain user turn.
    return {
      system,
      turns: history,
      prompt: finalText,
      lastTurnIsToolResult: true,
      toolCallId: tool.tool_call_id,
    };
  }
  return { system, turns: history, prompt: finalText };
}

/** The same conversion, used for the turns that precede the current one. */
function toTurnsForHistory(messages: BaseMessage[]): ChatTurn[] {
  const { turns } = { turns: [] as ChatTurn[] };
  for (const message of messages) {
    const text = messageText(message);
    if (message.getType() === "system") continue;
    if (message.getType() === "human") {
      turns.push({ role: "user", content: text });
      continue;
    }
    if (message.getType() === "tool") {
      const tool = message as ToolMessage;
      turns.push({
        role: "tool",
        toolCallId: tool.tool_call_id,
        name: typeof tool.name === "string" ? tool.name : "tool",
        content: text,
      });
      continue;
    }
    if (message.getType() === "ai") {
      const ai = message as AIMessage;
      const toolCalls: ToolCall[] = (ai.tool_calls ?? [])
        .filter((call) => Boolean(call.name))
        .map((call, index) => ({
          id: call.id ?? `call_${index}`,
          name: call.name,
          // A malformed call is surfaced rather than silently sent as `{}`.
          args:
            call.args && typeof call.args === "object"
              ? (call.args as Record<string, unknown>)
              : { __unparsed: String(call.args ?? "") },
        }));
      turns.push({ role: "assistant", content: text, ...(toolCalls.length ? { toolCalls } : {}) });
    }
  }
  return turns;
}

export const MAX_MODEL_CALLS_PER_RUN = 6;

export class MeteredChatModel extends BaseChatModel {
  private readonly config: MeteredModelConfig;
  private boundTools: ToolSpec[];
  /**
   * What this agent's calls have cost so far.
   *
   * An agent makes several calls, each metered and charged individually by the
   * funnel. The campaign's own spend meter is updated once per decision, so it
   * needs the total rather than one call's figure — otherwise a five-call agent
   * would look like a single cheap one.
   */
  usage: UsageMeter = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    calls: 0,
    models: [],
    lastNote: "",
  };

  constructor(config: MeteredModelConfig, tools: ToolSpec[] = [], shared?: UsageMeter) {
    super({});
    this.config = config;
    this.boundTools = tools;
    // A clone produced by `bindTools` must report into the same total, otherwise
    // the caller reads a meter that nothing increments and the campaign's spend
    // silently under-reports what the credit ledger was charged.
    if (shared) this.usage = shared;
  }

  _llmType(): string {
    return "aisle-metered";
  }

  /**
   * LangSmith prices and groups a chat run by these fields. `_llmType()` alone
   * is reported as model "Other", which is why the project total stayed at $0.
   */
  override getLsParams(_options: this["ParsedCallOptions"]): LangSmithParams {
    const model = getLlmOrDefault(this.config.modelId);
    return {
      ls_provider: model.providerId,
      ls_model_name: model.apiModel,
      ls_model_type: "chat",
    };
  }

  /** LangChain calls this to advertise tools to the model. */
  bindTools(tools: unknown[]): Runnable {
    const specs = tools.map(toToolSpec).filter((spec): spec is ToolSpec => spec !== null);
    return new MeteredChatModel(this.config, specs, this.usage);
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const { system, turns, prompt, lastTurnIsToolResult, toolCallId } = toTurns(messages);


    const request: CompleteRequest = {
      agent: this.config.agent === "intake" ? "trend" : this.config.agent,
      modelId: this.config.modelId,
      prompt,
      ...(system ? { system } : {}),
      ...(this.boundTools.length ? { tools: this.boundTools } : {}),
      ...(turns.length ? { history: turns } : {}),
      ...(lastTurnIsToolResult ? { lastTurnIsToolResult: true, toolCallId } : {}),
      ...(this.config.localBaseUrl ? { localBaseUrl: this.config.localBaseUrl } : {}),
      ...(this.config.localModel ? { localModel: this.config.localModel } : {}),
      ...(this.config.maxOutputTokens !== undefined
        ? { maxOutputTokens: this.config.maxOutputTokens }
        : {}),
    };

    this.config.onTurn?.({
      index: this.usage.calls + 1,
      messages: messages.length,
      history: turns.length,
      tools: this.boundTools.length,
      types: messages.map((m) => m.getType()),
    });

    const result = await this.config.complete(request, this.config.billing);

    // Every call is metered and charged by the funnel; the seat total is what the
    // campaign's spend meter is updated with.
    this.usage.calls += 1;
    this.usage.inputTokens += result.usage.inputTokens;
    this.usage.outputTokens += result.usage.outputTokens;
    this.usage.totalTokens += result.usage.totalTokens;
    this.usage.costUsd += result.usage.costUsd;
    this.usage.lastNote = result.note;
    if (!this.usage.models.includes(result.modelName)) this.usage.models.push(result.modelName);

    // A seat that could not answer must not look like an agent that chose to stop:
    // the caller falls back to deterministic rules on an exception, and would
    // otherwise act on an empty completion.
    if (result.status !== "ok") {
      throw new MeteredCallUnavailable(result);
    }

    const message = new AIMessage({
      content: result.text ?? "",
      usage_metadata: langsmithUsage(getLlmOrDefault(result.modelId), result.usage) as UsageMetadata,
      ...(result.toolCalls?.length
        ? {
            tool_calls: result.toolCalls.map((call) => ({
              name: call.name,
              args: call.args,
              id: call.id,
              type: "tool_call" as const,
            })),
          }
        : {}),
    });

    const generation: ChatGeneration = {
      text: typeof message.content === "string" ? message.content : "",
      message,
    };
    return { generations: [generation] };
  }
}

/**
 * The seat did not answer: no credits, nothing configured, or the provider failed.
 *
 * Carries the result so the caller can say *why* in the run trace instead of
 * reporting a generic framework error.
 */
export class MeteredCallUnavailable extends Error {
  readonly result: CompleteResult;
  constructor(result: CompleteResult) {
    super(result.note || `The ${result.modelName} seat did not answer (${result.status}).`);
    this.name = "MeteredCallUnavailable";
    this.result = result;
  }
}

/**
 * Turn a bound tool into the wire shape, accepting the two shapes LangChain uses.
 *
 * A tool an author wrote arrives flat: `{ name, description, schema }`. The
 * structured-output tool the agent adds for `responseFormat` arrives already in
 * OpenAI's wire shape: `{ type: "function", function: { name, description,
 * parameters } }`. Both reach `bindTools`, and a converter that knew only the
 * first would silently drop the second — which is exactly how an agent ends up
 * "finishing without a structured answer".
 */
function toToolSpec(candidate: unknown): ToolSpec | null {
  if (!candidate || typeof candidate !== "object") return null;
  const raw = candidate as {
    name?: unknown;
    description?: unknown;
    schema?: unknown;
    function?: { name?: unknown; description?: unknown; parameters?: unknown };
  };

  if (raw.function && typeof raw.function.name === "string" && raw.function.name) {
    return {
      name: raw.function.name,
      description: typeof raw.function.description === "string" ? raw.function.description : "",
      parameters: jsonSchemaForProvider(raw.function.parameters),
    };
  }

  if (typeof raw.name === "string" && raw.name) {
    return {
      name: raw.name,
      description: typeof raw.description === "string" ? raw.description : "",
      parameters: jsonSchemaForProvider(raw.schema),
    };
  }

  return null;
}

/**
 * A schema a provider will accept.
 *
 * Zod's JSON Schema output carries `$schema`, which OpenAI and Anthropic both
 * reject inside a function's parameters. Everything else passes through, so a
 * schema's `required` list and nested objects survive intact.
 */
/**
 * LangChain copies `usage_metadata` onto the LangSmith run through a merger that
 * keeps token counts and drops `total_cost`. Put the cost back before the run is
 * posted, or the project total stays $0 for a model LangSmith cannot price.
 */
const tracerWithCost = LangChainTracer.prototype as typeof LangChainTracer.prototype & { __aisleCost?: boolean };
if (!tracerWithCost.__aisleCost) {
  const original = tracerWithCost.onLLMEnd;
  tracerWithCost.onLLMEnd = function (run) {
    original.call(this, run);
    const metadata = run.extra?.metadata?.usage_metadata as (UsageMetadata & { input_cost?: number; output_cost?: number; total_cost?: number }) | undefined;
    const batches = (run.outputs as { generations?: { message?: AIMessage }[][] } | undefined)?.generations ?? [];
    for (const batch of batches) {
      for (const generation of batch) {
        const source = generation.message?.usage_metadata as (UsageMetadata & { input_cost?: number; output_cost?: number; total_cost?: number }) | undefined;
        if (!metadata || source?.total_cost == null) continue;
        metadata.input_cost = source.input_cost;
        metadata.output_cost = source.output_cost;
        metadata.total_cost = source.total_cost;
      }
    }
  };
  tracerWithCost.__aisleCost = true;
}

function jsonSchemaForProvider(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return { type: "object", properties: {} };
  // DynamicStructuredTool carries a Zod schema, not JSON Schema. Spreading the
  // Zod object sends implementation fields and loses enums/required properties.
  const json = schema instanceof z.ZodType ? z.toJSONSchema(schema, {target:'draft-7'}) : schema;
  const rest = { ...(json as Record<string, unknown>) };
  // OpenAI and Anthropic both reject `$schema` inside a function's parameters.
  delete rest.$schema;
  return { type: "object", ...rest };
}
