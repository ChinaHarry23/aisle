import type { MediaKind } from "./pr2-types";

export type RenderStage = "preparing" | "queued" | "loading" | "sampling" | "encoding" | "saving" | "complete" | "failed";
export type RenderProgress = {
  id: string;
  campaignId: string;
  kind: MediaKind;
  modelName: string;
  stage: RenderStage;
  promptId?: string;
  samplerNode: string;
  /** Ordered sampling stages, e.g. LTX base 8 steps followed by 3-step refinement. */
  samplers?: { node: string; steps: number }[];
  step: number;
  totalSteps: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
  sourceCreativeId: string;
  backendOnline?: boolean;
  /** Media provider the job runs on (`comfy`, `openai`, `google`, ...). Absent on jobs saved before cloud media. */
  provider?: string;
  /** A one-shot local worker owns a multi-clip production; percentages are per clip. */
  sequence?: { title: string; current: number; total: number; label: string; phase: "rendering" | "editing"; heartbeatAt: string };
};
export const renderActive = (job: RenderProgress) => !["complete", "failed"].includes(job.stage);
/** Cloud jobs run inside the provider's API call; there is no ComfyUI job to ask about. */
export const cloudRender = (job: Pick<RenderProgress, "provider" | "promptId">) =>
  job.provider ? job.provider !== "comfy" : /^(openai|google):/.test(job.promptId ?? "");
