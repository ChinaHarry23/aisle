export type LlmProviderId = "local" | "openai" | "anthropic" | "cursor";

export type AgentSlot = "trend" | "creative" | "compliance" | "media";

export type MeteredAgentId = AgentSlot | "intake";

export type LlmAssignment = {
  provider: LlmProviderId;
  modelId: string;
};

export type LlmModel = {
  id: string;
  providerId: LlmProviderId;
  provider: string;
  name: string;
  apiModel: string;
  blurb: string;
  bestFor: string;
  envKeys: string[];
  endpoint: string;
  estimateLabel: string;
  billing: {
    inputPerM: number;
    outputPerM: number;
  };
  notes?: string;
  /**
   * Output ceiling sent with every cloud call. It bounds what one call can
   * cost, so it is also what the credit hold reserves for output.
   */
  maxOutputTokens?: number;
  /** OpenAI reasoning model: takes `reasoning_effort` and rejects `temperature`. */
  reasoning?: boolean;
  /** Thinking effort: `reasoning_effort` on OpenAI, `output_config.effort` on Claude 5.x. */
  effort?: "low" | "medium" | "high";
  /** Provider shutdown date (YYYY-MM-DD), shown in pickers. */
  sunset?: string;
};

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  billedAs: string;
  estimate: boolean;
  latencyMs: number;
};

/**
 * A function the model may ask us to run.
 *
 * The schema is plain JSON Schema rather than a provider-specific shape, because
 * the same declaration is translated to OpenAI's `tools` array and to Anthropic's
 * `tools` array in `adapters.ts`. LangChain produces these from Zod schemas.
 */
export type ToolSpec = {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
};

/**
 * A tool call the model asked for.
 *
 * `id` exists because the provider requires the result to be tied back to the
 * request that produced it. `args` is already parsed: a provider that returns
 * unparseable arguments is treated as a malformed call rather than an empty one,
 * so a broken tool request cannot silently look like a call with no arguments.
 */
export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

/**
 * One turn of an agent conversation.
 *
 * A tool-using agent is inherently multi-turn: the model asks for a tool, we run
 * it, and the result goes back into the same conversation. Assistant turns carry
 * the calls they made so the provider can match results to requests. The shape is
 * deliberately provider-neutral — `adapters.ts` translates it — so the engine and
 * the tests never deal in OpenAI or Anthropic wire formats.
 */
export type ChatTurn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type CompleteRequest = {
  /** Seat the completion is billed/traced as. Intake maps onto `trend`. */
  agent: AgentSlot;
  modelId: string;
  prompt: string;
  /** Server-authored role instructions. The public completion route drops this field. */
  system?: string;
  /** Server-only output allowance for longer structured plans; public requests cannot set it. */
  maxOutputTokens?: number;
  localBaseUrl?: string;
  localModel?: string;
  /**
   * Tools the model may choose from. Absent or empty means a plain completion —
   * what every decision did before the agents existed.
   */
  tools?: ToolSpec[];
  /** Prior turns for the tool-calling loop. Absent means a single-shot call. */
  history?: ChatTurn[];
  /**
   * The `prompt` is not a user message but the result of a tool the model asked
   * for, so the provider needs it as a tool result paired to `toolCallId`.
   */
  lastTurnIsToolResult?: boolean;
  /** Which tool call `prompt` answers, when `lastTurnIsToolResult` is set. */
  toolCallId?: string;
};

export type CompleteResult = {
  provider: string;
  providerId: LlmProviderId;
  modelId: string;
  modelName: string;
  /** `no_credits`: a cloud call the user could not pay for, so nothing was sent. */
  status: "stubbed" | "ok" | "unconfigured" | "error" | "no_credits";
  usage: LlmUsage;
  text: string | null;
  /** Tool calls the model requested, in the order it asked for them. */
  toolCalls?: ToolCall[];
  note: string;
  at: string;
};
