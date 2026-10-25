import { randomUUID } from "node:crypto";
import { renderCampaignPoster } from "../../src/lib/media/campaign-poster";
import { lookupShelfPrices } from "../../src/lib/retail/whichgrocer/connection";
import { runEngine, type EngineOptions } from "../../src/lib/runtime/engine";
import { setShelfPriceLookup } from "../../src/lib/runtime/tools";
import type { Command } from "../../src/lib/runtime/types";
import { WorkflowRepository } from "./repository";
import { createServerResearchRuntime } from "../../src/lib/agents/trend-server";
import { findUserById } from "../../src/lib/auth/users";
import { billingFor } from "../../src/lib/billing/meter";

setShelfPriceLookup(lookupShelfPrices);

/** One durable job, checkpointed after each agent step and stopped at every human gate. */
export async function workOnce(repo: WorkflowRepository, workerId: string, options: EngineOptions = {}) {
  const job = repo.claim(workerId);
  if (!job) return false;
  let leaseValid = true;
  const heartbeat = setInterval(() => { try { leaseValid = repo.heartbeat(job); } catch { leaseValid = false; } }, 10_000);
  try {
    let command = job.nextCommand;
    for (let step = 0; step < 40; step++) {
      if (!leaseValid) throw new Error("Worker lost its lease. No further agent call was started.");
      const campaign = repo.campaign(job.user_id, job.campaign_id)!;
      const managed = repo.campaigns(job.user_id);
      const context = [...job.input.campaigns.filter(c => !managed.some(m => m.id === c.id)), ...managed];
      if (repo.pauseRequested(job)) command = { type: "PAUSE", actor: "founder" };
      // Resume a pause from its saved step; START must not repeat trend research.
      if (command.type === "START" && campaign.status === "paused" && campaign.run && campaign.run.step !== "intake.validate" && !campaign.trendQuality) {
        campaign.run.status = "running"; campaign.running = true;
        command = { type: "ADVANCE", actor: "system" };
      }
      // Recheck the owner's current role instead of trusting a saved/browser role.
      const owner = await findUserById(job.user_id);
      const billing = owner ? billingFor(owner) : undefined;
      const llm = options.llm ?? createServerResearchRuntime(billing);
      const result = await runEngine({ campaigns: context, now: new Date().toISOString() }, campaign, command, job.input.settings, job.input.brand, {
        ...options,
        billing,
        llm,
        maxSteps: 1,
        ownerUserId: job.user_id,
        researchAllowed: async () => leaseValid && !repo.pauseRequested(job) && (await options.researchAllowed?.() ?? true),
        renderPoster: options.renderPoster ?? ((input) => renderCampaignPoster({
          campaign: input.campaign,
          creative: input.creative,
          modelId: input.modelId,
          ownerId: job.user_id,
        })),
      });
      const complete = !result.canAdvance;
      repo.checkpoint(job, result, complete);
      if (complete) return true;
      command = { type: "ADVANCE", actor: "system" } satisfies Command;
    }
    throw new Error("Workflow safety limit reached. Inspect the saved trace before retrying.");
  } catch (error) {
    repo.fail(job, error instanceof Error ? error.message : "Worker failed; saved checkpoints are retained.");
  } finally { clearInterval(heartbeat); }
  return true;
}

if (process.argv.includes("--work")) {
  const repo = new WorkflowRepository();
  const id = `worker-${randomUUID()}`;
  let stopping = false;
  process.on("SIGTERM", () => { stopping = true; });
  process.on("SIGINT", () => { stopping = true; });
  console.log("Agent worker ready. Existing LLM/tool/media adapters are enabled; channel publishing remains simulated.");
  while (!stopping) {
    await workOnce(repo, id);
    if (!stopping) await new Promise(resolve => setTimeout(resolve, 500));
  }
  repo.close();
}
