/** Server-side creative planning. No template advertisement is substituted on failure. */
import type { BillingContext } from "../billing/meter";
import { runComplete } from "../llm/metered-complete";
import { getLlmOrDefault } from "../llm/catalog";
import { worstCaseUsd } from "../llm/estimate";
import type { CompleteRequest, CompleteResult } from "../llm/types";
import type { WorkspaceSettings } from "../settings";
import type { BrandProfile, Campaign, Creative } from "../types";
import { extractJson } from "../runtime/decide";
import { WorkflowError } from "../workflow/commands";
import { ART_DIRECTOR_SYSTEM, ART_DIRECTOR_VERSION } from "./art-director-system";
import { storyAdPlan, storyLayout, type StoryAdPlan, type StoryScene } from "./storyboard";
import type { AspectRatio, MediaModel } from "./pr2-types";

export type ArtDirection = {
  version: string; title: string; sellingIdea: string; hook: string;
  story: { setup: string; development: string; payoff: string };
  continuity: { subject: string; product: string; environment: string; lighting: string; screenDirection: string; visibleRecurringFace: boolean };
  prompt: string; shots: Pick<StoryScene, "label" | "beat" | "entryState" | "exitState" | "prompt">[];
  closing: { headline: string; cta: string }; reviewNotes: string[];
  author: CompleteResult; styleReference?: string;
  planningAttempts?: CompleteResult[];
};
export type DirectionInput = {
  campaign: Campaign; creative: Creative; brand: BrandProfile; settings: WorkspaceSettings;
  model: MediaModel; aspect: AspectRatio; durationSec?: number; edited?: boolean;
  /** A user-supplied example is inspiration/data, never a system instruction or a reusable script. */
  styleReference?: string;
  renderBudgetUsd?: number;
};

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkflowError(`Art director returned an invalid ${field}; no render started.`, 422);
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, max = 1000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new WorkflowError(`Art director omitted or exceeded ${field}; no render started.`, 422);
  return value.trim();
}
function illustrativeOnly(input: DirectionInput): boolean {
  const r = [input.campaign.notes, ...input.campaign.sharedContext.founderNotes, input.campaign.brief?.visualDirection, input.brand.visualStyle].filter(Boolean).join(" ");
  return /no bottle|no fabricated|never a fabricated|avoid showing[^.]*bottle/i.test(r);
}

export function artDirectionRequest(input: DirectionInput): CompleteRequest {
  const { campaign: c, creative, model, settings } = input;
  const assignment = settings.agents.creative;
  const layout = input.edited ? storyLayout(model.videoInput === "text") : [];
  const prohibitedRenderTerms = [...input.brand.bannedTerms, ...(c.brief?.claimsAvoid ?? []), ...(illustrativeOnly(input) ? ["bottle", "bottles"] : [])];
  return {
    agent: "creative", modelId: assignment.modelId, system: ART_DIRECTOR_SYSTEM,
    // Six self-contained shots plus their continuity bible need more than a short copy decision.
    maxOutputTokens: input.edited ? 6000 : 3000,
    localBaseUrl: settings.localBaseUrl, localModel: settings.localModel,
    prompt: JSON.stringify({
      task: model.kind === "image" ? "Design one campaign poster background" : input.edited ? "Direct a 30-second edited advertisement" : "Direct one native advertisement clip",
      campaign: { product: c.product, category: c.category, audience: c.targetAudience, objective: c.objective, channels: c.channels, country: c.country, researchedBrief: c.brief, approvedClaims: c.sharedContext.approvedClaims, founderNotes: c.sharedContext.founderNotes, notes: c.notes },
      brand: { tone: input.brand.tone, visualStyle: input.brand.visualStyle, bannedTerms: input.brand.bannedTerms, approvedTerms: input.brand.approvedTerms, colors: input.brand.colors },
      sourceCreative: { headline: creative.headline, subhead: creative.subhead, cta: creative.cta, sourceDescription: creative.prompt, hasGeneratedImage: creative.generation?.status === "ok", imageIsNotVisuallyInspected: true },
      rendererCapabilities: { name: model.name, kind: model.kind, aspect: input.aspect, durationSec: input.durationSec, inputMode: model.videoInput ?? "image", independentlyGeneratedShots: Boolean(input.edited), timingSlots: layout, authoredEndCard: input.edited ? { startSec: 26, durationSec: 4 } : null, supportsCharacterReference: false, hasCharacterReference: false, instruction: input.edited && model.videoInput === "text" ? "No image/character reference reaches these independent text-only takes. Do not show recurring faces; use product/hands and explicit matched states. Only one action per take. Do not imply that the same text locks an actor's identity." : "Use only the inputs actually supported. No fabricated reference or inspection claims." },
      styleReference: input.styleReference?.trim().slice(0, 4000) || null,
      styleReferencePolicy: "Optional artistic inspiration, not binding requirements. Adapt its mood/composition to the timing slots. Physics, model limits and founder restrictions override example wording. Do not block solely because the example's timing or physical states are impossible to copy exactly.",
      validation: { requiredContinuityField: "visibleRecurringFace: boolean", shotsCount: layout.length, prohibitedRenderTerms, positivePromptsOnly: "Do not mention prohibited terms even in a negative phrase such as 'no bottles'. Describe the permitted visible subject instead; put exclusions in reviewNotes. All render prompts and closing copy are scanned for these terms.", adjacentStates: "Each shot after the first must copy the preceding exitState EXACTLY into entryState. The chronological beats must include setup, development, payoff. Closing copy must honour founder corrections over old draft copy." },
    }),
  };
}

export function parseArtDirection(input: DirectionInput, author: CompleteResult): ArtDirection {
  if (author.status !== "ok" || !author.text) throw new WorkflowError(`Art director unavailable: ${author.note} No hardcoded prompt or render was substituted.`, 503);
  if (!Number.isFinite(author.usage.costUsd) || author.usage.costUsd < 0) throw new WorkflowError("Art director returned invalid usage; no render started.", 422);
  const data = record(extractJson<unknown>(author.text), "JSON plan");
  if (data.status === "blocked") throw new WorkflowError(`Creative plan needs review: ${text(data.reason, "blocked reason", 6000)}`, 422);
  if (data.status !== "ready") throw new WorkflowError("Art director did not return a ready plan; no render started.", 422);
  const story = record(data.story, "story"), continuity = record(data.continuity, "continuity"), closing = record(data.closing, "closing");
  if (typeof continuity.visibleRecurringFace !== "boolean") throw new WorkflowError("Art director must declare whether recurring faces are visible.", 422);
  if (input.edited && input.model.videoInput === "text" && continuity.visibleRecurringFace) throw new WorkflowError("This plan needs character references, but this renderer uses independent text-only takes. Revise the plan or enable a reference workflow before rendering.", 422);
  const expected = input.edited ? storyLayout(input.model.videoInput === "text").length : 0;
  if (!Array.isArray(data.shots) || data.shots.length !== expected) throw new WorkflowError("Art director shot count does not match the renderer; no render started.", 422);
  const shots = data.shots.map((value, i) => {
    const s = record(value, `shot ${i + 1}`);
    if (!["setup", "development", "payoff"].includes(String(s.beat))) throw new WorkflowError("Each shot requires a narrative beat.", 422);
    return { label: text(s.label, "shot label", 100), beat: s.beat as StoryScene["beat"], entryState: text(s.entryState, "entry state", 600), exitState: text(s.exitState, "exit state", 600), prompt: text(s.prompt, "shot prompt", 2400) };
  });
  if (shots.length) {
    const order = { setup: 0, development: 1, payoff: 2 };
    if (new Set(shots.map(s => s.beat)).size !== 3 || shots.some((s, i) => i > 0 && order[s.beat!] < order[shots[i - 1].beat!])) throw new WorkflowError("The shot plan needs chronological setup, development and payoff.", 422);
    if (shots.some((s, i) => i > 0 && s.entryState !== shots[i - 1].exitState)) throw new WorkflowError("Shot entry/exit states do not match; repair continuity before rendering.", 422);
    if (new Set(shots.map(s => s.prompt)).size !== shots.length) throw new WorkflowError("The art director repeated a shot instead of developing the story.", 422);
  }
  if (!Array.isArray(data.reviewNotes) || data.reviewNotes.some(v => typeof v !== "string" || v.length > 600) || data.reviewNotes.length > 8) throw new WorkflowError("Art director review notes are invalid.", 422);
  const direction: ArtDirection = {
    version: ART_DIRECTOR_VERSION, title: text(data.title, "title", 180), sellingIdea: text(data.sellingIdea, "selling idea"), hook: text(data.hook, "hook"),
    story: { setup: text(story.setup, "setup"), development: text(story.development, "development"), payoff: text(story.payoff, "payoff") },
    continuity: { subject: text(continuity.subject, "subject bible"), product: text(continuity.product, "product bible"), environment: text(continuity.environment, "environment bible"), lighting: text(continuity.lighting, "lighting bible"), screenDirection: text(continuity.screenDirection, "screen direction"), visibleRecurringFace: continuity.visibleRecurringFace },
    prompt: text(data.prompt, "generation prompt", 6500), shots,
    closing: { headline: text(closing.headline, "closing headline", 180), cta: text(closing.cta, "closing CTA", 100) },
    reviewNotes: data.reviewNotes as string[], author: { ...author, text: null }, ...(input.styleReference ? { styleReference: input.styleReference.slice(0, 4000) } : {}),
  };
  const rendered = [direction.prompt, ...shots.map(s => s.prompt), direction.closing.headline, direction.closing.cta].join("\n").toLowerCase();
  const banned = [...input.brand.bannedTerms, ...(input.campaign.brief?.claimsAvoid ?? [])].map(v => v.trim().toLowerCase()).filter(Boolean);
  if (banned.some(term => rendered.includes(term))) throw new WorkflowError("The generated visual/copy plan includes a prohibited claim or brand term; no render started.", 422);
  if (illustrativeOnly(input) && /\bbottles?\b/i.test(rendered)) throw new WorkflowError("The plan invents a bottle despite the illustrative-only restriction; no render started.", 422);
  return direction;
}

export async function directMedia(input: DirectionInput, billing: BillingContext | undefined, complete = runComplete): Promise<{ direction: ArtDirection; plan?: StoryAdPlan }> {
  const initial = artDirectionRequest(input);
  let req = initial;
  const spent = input.campaign.spend.inferenceUsd + input.campaign.spend.mediaUsd;
  const attempts: CompleteResult[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const usedCost = attempts.reduce((sum, result) => sum + result.usage.costUsd, 0);
    const plannedCost = worstCaseUsd(getLlmOrDefault(req.modelId), req);
    if (spent + usedCost + plannedCost + (input.renderBudgetUsd ?? 0) > (input.campaign.spendCapUsd ?? input.campaign.spend.capUsd)) throw new WorkflowError("Art direction and rendering would exceed this campaign's automation budget.", 409);
    const result = await complete(req, billing);
    attempts.push(result);
    let direction: ArtDirection;
    try { direction = parseArtDirection(input, result); }
    catch (error) {
      const previous = extractJson<Record<string, unknown>>(result.text);
      // One bounded schema/continuity repair, never a workaround for missing assets,
      // an explicit blocked decision, unavailable models or exhausted credits.
      if (attempt || !(error instanceof WorkflowError) || error.status !== 422 || previous?.status === "blocked" || result.status !== "ok" || !Number.isFinite(result.usage.costUsd) || result.usage.costUsd < 0) throw error;
      req = { ...initial, prompt: JSON.stringify({ ...JSON.parse(initial.prompt), repair: { validationError: error.message, previousPlan: result.text?.slice(0, 24000), instruction: "Keep the concept. Repair ALL constraints, not just the first error: exactly copy adjacent exitState into entryState; remove prohibited terms even in negative clauses from all render prompts; repeat precise subject/product/location/light cues in every shot. Return the complete corrected JSON, not a patch. No relaxation of claims, reference limits or physics." } }) };
      continue;
    }
    direction.planningAttempts = attempts.map(value => ({ ...value, text: null }));
    if (attempts.length > 1) {
      const total = (key: keyof Pick<CompleteResult["usage"], "inputTokens" | "outputTokens" | "totalTokens" | "costUsd" | "latencyMs">) => attempts.reduce((sum, value) => sum + value.usage[key], 0);
      direction.author = { ...direction.author, note: `${direction.author.note} Total planning usage includes ${attempts.length} calls, including one validation repair.`, usage: { ...direction.author.usage, inputTokens: total("inputTokens"), outputTokens: total("outputTokens"), totalTokens: total("totalTokens"), costUsd: total("costUsd"), latencyMs: total("latencyMs"), billedAs: `Art direction · ${attempts.length} calls` } };
    }
    return { direction, plan: input.edited ? storyAdPlan(input.campaign, input.model.videoInput === "text", { title: direction.title, scenes: direction.shots, closing: direction.closing }) : undefined };
  }
  throw new WorkflowError("Art direction did not produce a valid plan; no render started.", 422);
}
