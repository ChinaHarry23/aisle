/** Private durable render tracking. No provider prompts or account credentials are exposed. */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { WorkflowError } from "../workflow/commands";
import { renderActive, type RenderProgress } from "./progress-types";

const initialized = new Set<string>();
function database() {
  // Vercel's filesystem is read-only outside /tmp (per instance, so progress there is best effort).
  const file = process.env.AISLE_MEDIA_PROGRESS_DB
    || (process.env.VERCEL ? path.join(os.tmpdir(), "aisle-media-progress.db") : path.resolve("data/media-progress.db"));
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    // Set the busy handler before any locking pragma. The browser and local
    // worker both receive progress events; reads must not repeatedly run DDL.
    db.exec("pragma busy_timeout=5000");
    if (!initialized.has(file)) {
      db.exec("pragma journal_mode=WAL; create table if not exists media_progress(id text primary key,user_id text not null,campaign_id text not null,prompt_id text unique,active integer not null,snapshot text not null); create index if not exists media_progress_owner on media_progress(user_id,campaign_id);");
      initialized.add(file);
    }
    return db;
  } catch (error) { db.close(); throw error; }
}

export function createRenderJob(userId: string, input: Pick<RenderProgress, "campaignId" | "kind" | "modelName" | "sourceCreativeId"> & Partial<Pick<RenderProgress, "provider">>, adopted?: Partial<RenderProgress>) {
  const db = database();
  try {
    db.exec("begin immediate");
    if (!adopted && db.prepare("select id from media_progress where user_id=? and campaign_id=? and active=1").get(userId, input.campaignId)) throw new WorkflowError("This campaign already has a render in progress. Watch the progress panel before generating again.", 409);
    if (adopted?.promptId) {
      const row = db.prepare("select snapshot from media_progress where user_id=? and campaign_id=? and prompt_id=?").get(userId, input.campaignId, adopted.promptId);
      if (row) { db.exec("commit"); return JSON.parse(String(row.snapshot)) as RenderProgress; }
    }
    const at = new Date().toISOString();
    const job: RenderProgress = { ...input, id: randomUUID(), stage: "preparing", samplerNode: input.kind === "video" ? "10" : "8", step: 0, totalSteps: 0, createdAt: at, updatedAt: at, ...adopted };
    db.prepare("insert into media_progress values(?,?,?,?,?,?)").run(job.id, userId, job.campaignId, job.promptId ?? null, Number(renderActive(job)), JSON.stringify(job));
    db.exec("commit");
    return job;
  } catch (error) { db.exec("rollback"); throw error; }
  finally { db.close(); }
}

export function listRenderJobs(userId: string, campaignId: string): RenderProgress[] {
  const db = database();
  try { return db.prepare("select snapshot from media_progress where user_id=? and campaign_id=? order by active desc,json_extract(snapshot,'$.createdAt') desc limit 10").all(userId, campaignId).map(row => JSON.parse(String(row.snapshot))); }
  finally { db.close(); }
}

export function updateRenderJob(id: string, change: Partial<RenderProgress> | ((job: RenderProgress) => Partial<RenderProgress>)) {
  const db = database();
  try {
    db.exec("begin immediate");
    const row = db.prepare("select snapshot from media_progress where id=?").get(id);
    if (!row) { db.exec("commit"); return; }
    const job = JSON.parse(String(row.snapshot)) as RenderProgress;
    const patch = typeof change === "function" ? change(job) : change;
    // Late socket messages must not erase terminal outcomes. A verified saved asset
    // may still reconcile a prior timeout into completion.
    if (!renderActive(job) && patch.stage !== "complete") { db.exec("commit"); return job; }
    const next = { ...job, ...patch, id: job.id, campaignId: job.campaignId, updatedAt: new Date().toISOString() };
    db.prepare("update media_progress set prompt_id=?,active=?,snapshot=? where id=?").run(next.promptId ?? null, Number(renderActive(next)), JSON.stringify(next), id);
    db.exec("commit");
    return next;
  } catch (error) { db.exec("rollback"); throw error; }
  finally { db.close(); }
}

export function renderJobForPrompt(promptId: string): RenderProgress | undefined {
  const db = database();
  try { const row = db.prepare("select snapshot from media_progress where prompt_id=?").get(promptId); return row ? JSON.parse(String(row.snapshot)) : undefined; }
  finally { db.close(); }
}
