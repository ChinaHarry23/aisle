/** Private, local durable queue. Browser-supplied prompts and owner ids never enter it. */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { UserRole } from "../auth/types";
import { WorkflowError } from "../workflow/commands";
import type { StoryAdPlan } from "./storyboard";
import type { GenerateRequest, MediaGeneration } from "./types";
import { updateRenderJob } from "./progress-store";
import type { ArtDirection } from "./art-direction";

export type ProductionInput = {
  ownerId: string; role: UserRole; campaignId: string; creativeId: string;
  expectedUrl: string | null; sourceSnapshot: string; workflowManaged: boolean;
  request: GenerateRequest; plan: StoryAdPlan; artDirection?: ArtDirection;
};
export type ProductionJob = {
  id: string; renderId: string; input: ProductionInput;
  status: "queued" | "running" | "complete" | "failed";
  workerId?: string; leaseUntil?: number; createdAt: string;
  shots: { index: number; promptId?: string; generation?: MediaGeneration; file?: string }[];
  generation?: MediaGeneration; error?: string;
};

export class ProductionRepository {
  readonly db: DatabaseSync;
  constructor(file = process.env.AISLE_MEDIA_PRODUCTION_DB || path.resolve("data/media-productions.db")) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("pragma busy_timeout=5000; pragma journal_mode=WAL; create table if not exists productions(id text primary key, owner_id text not null, campaign_id text not null, status text not null, snapshot text not null); create unique index if not exists production_active on productions(owner_id,campaign_id) where status in ('queued','running'); create table if not exists media_worker(id text primary key, seen integer not null);");
  }
  close() { this.db.close(); }
  private write(job: ProductionJob) {
    this.db.prepare("update productions set status=?,snapshot=? where id=?").run(job.status, JSON.stringify(job), job.id);
    return job;
  }
  workerSeen(workerId: string, now = Date.now()) {
    this.db.prepare("insert into media_worker values(?,?) on conflict(id) do update set seen=excluded.seen").run(workerId, now);
    // A production waiting behind another one is healthy, not an abandoned HTTP request.
    for (const row of this.db.prepare("select snapshot from productions where status='queued'").all()) {
      const job = JSON.parse(String(row.snapshot)) as ProductionJob;
      updateRenderJob(job.renderId, progress => progress.sequence ? { sequence: { ...progress.sequence, heartbeatAt: new Date(now).toISOString() } } : {});
    }
  }
  workerOnline(now = Date.now()) {
    return Boolean(this.db.prepare("select id from media_worker where seen>? limit 1").get(now - 30_000));
  }
  hasActive(ownerId: string, campaignId: string) {
    return Boolean(this.db.prepare("select id from productions where owner_id=? and campaign_id=? and status in ('queued','running')").get(ownerId, campaignId));
  }
  enqueue(renderId: string, input: ProductionInput) {
    if (!["comfy:ltx-2.5", "comfy:minimax-h3"].includes(input.request.modelId) || input.request.kind !== "video" || input.plan.durationSec !== 30) throw new WorkflowError("Story ads require a supported local video model.");
    if (this.hasActive(input.ownerId, input.campaignId)) throw new WorkflowError("This campaign already has a story production queued.", 409);
    const job: ProductionJob = { id: randomUUID(), renderId, input, status: "queued", shots: [], createdAt: new Date().toISOString() };
    this.db.prepare("insert into productions values(?,?,?,?,?)").run(job.id, input.ownerId, input.campaignId, job.status, JSON.stringify(job));
    return job;
  }
  get(ownerId: string, id: string): ProductionJob | undefined {
    const row = this.db.prepare("select snapshot from productions where owner_id=? and id=?").get(ownerId, id);
    return row ? JSON.parse(String(row.snapshot)) : undefined;
  }
  /** A lost renderer may still be running remotely: do not automatically submit it again. */
  recoverExpired(now = Date.now()) {
    const rows = this.db.prepare("select snapshot from productions where status='running'").all();
    for (const row of rows) {
      const job = JSON.parse(String(row.snapshot)) as ProductionJob;
      if ((job.leaseUntil ?? 0) > now) continue;
      const error = "The story worker stopped. Completed scenes and submitted render IDs are retained; inspect this production before retrying.";
      this.write({ ...job, status: "failed", error });
      updateRenderJob(job.renderId, { stage: "failed", error });
    }
  }
  claim(workerId: string): ProductionJob | undefined {
    this.db.exec("begin immediate");
    try {
      this.recoverExpired();
      // Serialize full productions across workers to keep local GPU memory bounded.
      if (this.db.prepare("select id from productions where status='running' limit 1").get()) { this.db.exec("commit"); return; }
      const row = this.db.prepare("select snapshot from productions where status='queued' order by rowid limit 1").get();
      if (!row) { this.db.exec("commit"); return; }
      const job: ProductionJob = { ...JSON.parse(String(row.snapshot)), status: "running", workerId, leaseUntil: Date.now() + 90_000 };
      this.write(job); this.db.exec("commit"); return job;
    } catch (error) { this.db.exec("rollback"); throw error; }
  }
  checkpoint(job: ProductionJob, patch: Partial<Pick<ProductionJob, "shots" | "generation" | "status" | "error">> = {}) {
    this.db.exec("begin immediate");
    try {
      const current = this.get(job.input.ownerId, job.id);
      if (!current || current.status !== "running" || current.workerId !== job.workerId || (current.leaseUntil ?? 0) < Date.now()) throw new Error("Story worker lost its lease. No more scenes may be submitted.");
      const next = { ...current, ...patch, leaseUntil: Date.now() + 90_000 };
      this.write(next); this.db.exec("commit"); Object.assign(job, next); return next;
    } catch (error) { this.db.exec("rollback"); throw error; }
  }
}
