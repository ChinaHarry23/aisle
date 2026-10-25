import { randomUUID } from "node:crypto";
import { ProductionRepository } from "../../src/lib/media/production-store";
import { workProductionOnce } from "../../src/lib/media/production";
import { closeProgressMonitor } from "../../src/lib/media/progress";

if (process.argv.includes("--work")) {
  const repo = new ProductionRepository();
  const id = `media-${randomUUID()}`;
  let stopping = false;
  process.on("SIGTERM", () => { stopping = true; });
  process.on("SIGINT", () => { stopping = true; });
  console.log("Local story-ad worker ready: 30s narrative productions, scene checkpoints, no paid fallback or publication.");
  while (!stopping) {
    try {
      if (await workProductionOnce(repo, id)) continue;
    } catch (error) { console.error("Story worker:", error instanceof Error ? error.message : "Queue unavailable"); }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  repo.close();
  closeProgressMonitor();
}
