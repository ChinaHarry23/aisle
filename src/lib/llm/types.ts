export type LlmProviderId = "local" | "openai" | "anthropic" | "cursor";

export type AgentSlot = "trend" | "creative" | "compliance" | "media";

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

export type CompleteRequest = {
  agent: AgentSlot;
  modelId: string;
  prompt: string;
  localBaseUrl?: string;
  localModel?: string;
};

export type CompleteResult = {
  provider: string;
  providerId: LlmProviderId;
  modelId: string;
  modelName: string;
  status: "stubbed" | "ok" | "unconfigured" | "error";
  usage: LlmUsage;
  text: string | null;
  note: string;
  at: string;
};
