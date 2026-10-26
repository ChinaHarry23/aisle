import {recordStoredTrend} from '../../src/lib/trend/quality';
import {markDeliveryStored} from '../../src/lib/trend/delivery';
import { retailUploadSchema } from "../../src/lib/trend/internal-retail";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { blankCampaign } from "../../src/lib/seed";
import { applySelectedFeedback } from "../../src/lib/insights";
import { isArchived } from "../../src/lib/campaign-lifecycle";
import { assertTransition, parseCommand, WorkflowError } from "../../src/lib/workflow/commands";
import { founderCollectorOverrides, founderInput } from "../../src/lib/workflow/founder-input";
import type { Campaign } from "../../src/lib/types";
import type { Command, EngineResult } from "../../src/lib/runtime/types";
import type { WorkflowJob, WorkflowSubmission } from "../../src/lib/workflow/types";
import { applyStudioMedia, type StudioMediaUpdate } from "../../src/lib/media/persistence";

type Row = { id: string; user_id: string; campaign_id: string; request_hash: string; command: string; payload: string; next_command: string; status: WorkflowJob["status"]; created_at: string; updated_at: string; message: string; result: string | null; worker: string | null; pause_requested: number; revision: number };
type ClaimedJob = Row & { input: WorkflowSubmission; nextCommand: Command };

/** A local, durable queue shared by the API and worker processes (WAL + atomic claims). */
export class WorkflowRepository {
  readonly db: DatabaseSync;
  constructor(file = process.env.AISLE_WORKFLOW_DB || path.resolve("data/workflow.db")) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`pragma journal_mode=WAL; pragma busy_timeout=5000;
      create table if not exists workflow_campaigns (user_id text, campaign_id text, snapshot text not null, revision integer not null default 0, primary key(user_id,campaign_id));
      create table if not exists workflow_jobs (
        id text primary key, user_id text not null, campaign_id text not null, request_key text not null,
        request_hash text not null, command text not null, next_command text not null, payload text not null,
        status text not null, created_at text not null, updated_at text not null, message text not null,
        result text, worker text, lease_until integer not null default 0, pause_requested integer not null default 0,
        revision integer not null default 0, unique(user_id,request_key));
      create index if not exists workflow_queue on workflow_jobs(status,created_at);
      create unique index if not exists one_active_campaign on workflow_jobs(user_id,campaign_id) where status in ('queued','running');
      create table if not exists workflow_workers (id text primary key, seen integer not null);
      create table if not exists workflow_recovery (job_id text primary key, revision integer not null, result text not null, complete integer not null);
      create table if not exists trend_creative_inbox (user_id text not null, job_id text not null, started_at text not null, primary key(user_id,job_id));
    `);
  }
  close() { this.db.close(); }
  private transaction<T>(fn: () => T): T {
    this.db.exec("begin immediate");
    try { const value = fn(); this.db.exec("commit"); return value; }
    catch (error) { this.db.exec("rollback"); throw error; }
  }
  private raw(user: string, id: string) {
    const row = this.db.prepare("select * from workflow_jobs where user_id=? and id=?").get(user, id) as Row | undefined;
    if (!row) throw new WorkflowError("Workflow job not found.", 404);
    return row;
  }
  private activeJob(user: string, campaignId: string) {
    return this.db.prepare("select id from workflow_jobs where user_id=? and campaign_id=? and status in ('queued','running')").get(user, campaignId) as { id: string } | undefined;
  }
  private public(row: Row): WorkflowJob {
    return { id: row.id, campaignId: row.campaign_id, command: row.command, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, message: row.message, result: row.result ? JSON.parse(row.result) : null };
  }
  get(user: string, id: string) { return this.public(this.raw(user, id)); }
  list(user: string) { return (this.db.prepare("select * from workflow_jobs where user_id=? order by created_at desc limit 50").all(user) as Row[]).map(r => this.public(r)); }
  campaigns(user: string): Campaign[] {
    return this.db.prepare("select snapshot from workflow_campaigns where user_id=?").all(user).map(r => JSON.parse(String(r.snapshot)));
  }
  campaign(user: string, id: string): Campaign | null {
    const row = this.db.prepare("select snapshot from workflow_campaigns where user_id=? and campaign_id=?").get(user, id);
    return row ? JSON.parse(String(row.snapshot)) : null;
  }
  saveMedia(user: string, id: string, update: StudioMediaUpdate): Campaign {
    return this.transaction(() => {
      const current = this.campaign(user, id);
      if (!current) throw new WorkflowError("Campaign not found.", 404);
      const active = this.activeJob(user, id);
      if (active) throw new WorkflowError("Wait for the active workflow before changing media.", 409);
      const next = applyStudioMedia(current, update);
      this.db.prepare("update workflow_campaigns set snapshot=?,revision=revision+1 where user_id=? and campaign_id=?").run(JSON.stringify(next), user, id);
      return next;
    });
  }
  enqueue(user: string, key: string, input: WorkflowSubmission): WorkflowJob {
    if (!key || key.length > 150) throw new WorkflowError("A valid Idempotency-Key is required.");
    if (!input?.campaign || typeof input.campaign.id !== "string" || !/^[a-zA-Z0-9_-]{1,150}$/.test(input.campaign.id) || !input.brand || !input.settings || !Array.isArray(input.campaigns)) throw new WorkflowError("Campaign and workspace context are required.");
    const command = parseCommand(input.command);
    const hash = createHash("sha256").update(JSON.stringify({ id: input.campaign.id, command })).digest("hex");
    return this.transaction(() => {
      const duplicate = this.db.prepare("select * from workflow_jobs where user_id=? and request_key=?").get(user, key) as Row | undefined;
      if (duplicate) {
        if (duplicate.request_hash !== hash) throw new WorkflowError("Idempotency key was already used for another command.", 409);
        return this.public(duplicate);
      }
      const active = this.activeJob(user, input.campaign.id);
      if (active) {
        if (command.type === "PAUSE") {
          this.db.prepare("update workflow_jobs set pause_requested=1, message=? where id=?").run("Pause requested; waiting for the current agent step to finish.", active.id);
          return this.get(user, active.id);
        }
        throw new WorkflowError("This campaign already has an active job. Open Workflow operations to see its progress.", 409);
      }
      let current = this.campaign(user, input.campaign.id);
      // The trash lives on the workspace document, which the API loads on the
      // server and passes in as `campaigns`; the durable snapshot never has it.
      const inWorkspace = input.campaigns.find((item) => item?.id === input.campaign.id);
      if ((isArchived(current ?? {}) || isArchived(inWorkspace ?? {})) && command.type !== "PAUSE") {
        throw new WorkflowError("This campaign is in the trash. Restore it before the agents can continue.", 409);
      }
      if (!current || (current.status === "draft" && command.type === "START")) {
        if (command.type !== "START" || input.campaign.status !== "draft") throw new WorkflowError("Start a new draft to enter the durable workflow. Existing legacy results are not silently imported.", 409);
        // Only founder inputs cross the trust boundary. Never accept browser approvals, logs or results.
        const raw = input.campaign;
        const fields = founderInput(raw);
        const retail = raw.internalDataAuthorised === true && raw.retailUpload !== undefined ? retailUploadSchema.safeParse(raw.retailUpload) : null;
        if (retail && !retail.success) throw new WorkflowError("Invalid aggregate retail upload.");
        const fresh = {
          ...applySelectedFeedback(
            blankCampaign(fields, input.brand, null, input.settings, null),
            input.savedInsights ?? [],
            raw.feedbackInsightIds,
            input.campaigns,
          ),
          id: raw.id,
          internalDataAuthorised: raw.internalDataAuthorised === true,
          ...(retail?.success ? { retailUpload: retail.data } : {}),
          ...(raw.dataAccessPolicy === undefined ? {} : { dataAccessPolicy: { externalSources: Array.isArray(raw.dataAccessPolicy?.externalSources) ? raw.dataAccessPolicy.externalSources.filter((name: unknown): name is string => typeof name === "string") : [] } }),
        };
        if (current) { fresh.log = current.log; fresh.createdAt = current.createdAt; }
        current = fresh;
        this.db.prepare("insert into workflow_campaigns(user_id,campaign_id,snapshot) values(?,?,?) on conflict(user_id,campaign_id) do update set snapshot=excluded.snapshot").run(user, current.id, JSON.stringify(current));
      }
      // These are explicit founder-controlled settings, never generated results or approvals.
      // A paused research job can receive a new aggregate export on explicit
      // START. Preserve the durable scope/results; import only validated inputs.
      if ((command.type === 'START' || command.type === 'RESOLVE_TREND' && command.action === 'provide_data') && current.status === 'paused') {
        if (input.campaign.internalDataAuthorised === true && input.campaign.retailUpload !== undefined) {
          const retail=retailUploadSchema.safeParse(input.campaign.retailUpload);
          if(!retail.success)throw new WorkflowError('Invalid aggregate retail upload.');
          current.retailUpload=retail.data;
          current.internalDataAuthorised=true;
        } else if (input.campaign.internalDataAuthorised === false) {
          current.internalDataAuthorised=false;
          current.retailUpload=undefined;
        }
      }
      if (Number.isFinite(input.campaign.spendCapUsd) && input.campaign.spendCapUsd! > 0) current.spendCapUsd = input.campaign.spendCapUsd;
      if (command.type === "COLLECT_FEEDBACK") current.collectorOverrides = founderCollectorOverrides(current, input.campaign.collectorOverrides);
      assertTransition(current, command);
      this.db.prepare("update workflow_campaigns set snapshot=? where user_id=? and campaign_id=?").run(JSON.stringify(current), user, current.id);
      const id = randomUUID(), at = new Date().toISOString();
      const revision = Number(this.db.prepare("select revision from workflow_campaigns where user_id=? and campaign_id=?").get(user, current.id)?.revision);
      this.db.prepare(`insert into workflow_jobs(id,user_id,campaign_id,request_key,request_hash,command,next_command,payload,status,created_at,updated_at,message,revision) values(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, user, current.id, key, hash, command.type, JSON.stringify(command), JSON.stringify({ ...input, campaign: current, command }), "queued", at, at, "Queued for the agent worker.", revision);
      return this.get(user, id);
    });
  }
  private touchWorker(id: string) { this.db.prepare("insert into workflow_workers(id,seen) values(?,?) on conflict(id) do update set seen=excluded.seen").run(id, Date.now()); }
  workerStatus() {
    const seen = Number(this.db.prepare("select max(seen) as seen from workflow_workers").get()?.seen || 0);
    return { online: Date.now() - seen < 30_000, lastSeen: seen ? new Date(seen).toISOString() : null };
  }
  recoverExpired(now = Date.now()) {
    this.db.prepare("update workflow_jobs set status='interrupted', worker=null, message=?, updated_at=? where status='running' and lease_until < ?")
      .run("Worker stopped before confirming the next checkpoint. Inspect provider usage before explicitly retrying; the last external call may have completed.", new Date(now).toISOString(), now);
  }
  claim(worker: string): ClaimedJob | null {
    this.touchWorker(worker);
    return this.transaction(() => {
      this.recoverExpired();
      // Serialize per workspace so two campaigns cannot race a scheduling decision.
      const row = this.db.prepare(`update workflow_jobs set status='running',worker=?,lease_until=?,updated_at=?,message='Agent worker running.' where id=(select q.id from workflow_jobs q where q.status='queued' and not exists(select 1 from workflow_jobs r where r.user_id=q.user_id and r.status='running') order by q.created_at,q.rowid limit 1) returning *`)
        .get(worker, Date.now() + 60_000, new Date().toISOString()) as Row | undefined;
      return row ? { ...row, input: JSON.parse(row.payload), nextCommand: JSON.parse(row.next_command) } : null;
    });
  }
  heartbeat(job: ClaimedJob) {
    this.touchWorker(job.worker!);
    const result = this.db.prepare("update workflow_jobs set lease_until=? where id=? and worker=? and status='running'").run(Date.now() + 60_000, job.id, job.worker!);
    return result.changes === 1;
  }
  pauseRequested(job: ClaimedJob) { return !!this.raw(job.user_id, job.id).pause_requested; }
  checkpoint(job: ClaimedJob, result: EngineResult, complete: boolean) {
    const before=this.raw(job.user_id,job.id);
    if(before.worker!==job.worker||before.status!=='running')throw new WorkflowError('Worker lease lost.',409);
    // Outside the following transaction: a failed canonical commit leaves the
    // accepted findings/result recoverable without calling any provider again.
    this.db.prepare('insert into workflow_recovery(job_id,revision,result,complete) values(?,?,?,?) on conflict(job_id) do update set revision=excluded.revision,result=excluded.result,complete=excluded.complete')
      .run(job.id,before.revision,JSON.stringify(result),complete?1:0);
    const stored=structuredClone(result);
    this.transaction(() => {
      const row = this.raw(job.user_id, job.id);
      if (row.worker !== job.worker || row.status !== "running") throw new WorkflowError("Worker lease was lost; result was not committed.", 409);
      if(row.revision!==before.revision)throw new WorkflowError('Checkpoint revision changed.',409);
      const canonical=this.db.prepare('select revision from workflow_campaigns where user_id=? and campaign_id=?').get(job.user_id,job.campaign_id);
      if(canonical?.revision!==row.revision)throw new WorkflowError('Campaign revision changed; stale checkpoint rejected.',409);
      const current=this.campaign(job.user_id,job.campaign_id);
      if(current?.run?.id&&['running','paused','awaiting_human'].includes(current.run.status)&&stored.campaign.run?.id!==current.run.id&&current.status!=='draft')throw new WorkflowError('Run changed.',409);
      if(row.pause_requested&&stored.campaign.trendDelivery?.state==='ACKNOWLEDGED'&&!current?.trendDelivery?.acknowledgedAt)throw new WorkflowError('Pause prevents a new handoff.',409);
      recordStoredTrend(stored.campaign);markDeliveryStored(stored.campaign);
      const revision = row.revision + 1;
      this.db.prepare("update workflow_campaigns set snapshot=?,revision=? where user_id=? and campaign_id=?").run(JSON.stringify(stored.campaign), revision, job.user_id, job.campaign_id);
      this.db.prepare("update workflow_jobs set result=?,next_command=?,status=?,message=?,updated_at=?,revision=? where id=?")
        .run(JSON.stringify(stored), JSON.stringify({ type: "ADVANCE", actor: "system" }), complete ? "completed" : "running", stored.message, new Date().toISOString(), revision, job.id);
      this.db.prepare('delete from workflow_recovery where job_id=?').run(job.id);
    });
    Object.assign(result,stored);
  }
  recoverCheckpoint(job:ClaimedJob):boolean {
    const draft=this.db.prepare('select * from workflow_recovery where job_id=?').get(job.id);
    if(!draft)return false;
    const row=this.raw(job.user_id,job.id);
    if(row.revision!==draft.revision||row.pause_requested)throw new WorkflowError('Recovery draft superseded or paused; no dispatch.',409);
    this.checkpoint(job,JSON.parse(String(draft.result)),Boolean(draft.complete));return true;
  }
  claimCreativeJob(user:string,jobId:string):boolean {
    return this.db.prepare('insert into trend_creative_inbox(user_id,job_id,started_at) values(?,?,?) on conflict(user_id,job_id) do nothing')
      .run(user,jobId,new Date().toISOString()).changes===1;
  }
  fail(job: ClaimedJob, message: string) {
    this.db.prepare("update workflow_jobs set status='failed',message=?,updated_at=? where id=? and worker=? and status='running'").run(message.slice(0, 1000), new Date().toISOString(), job.id, job.worker!);
  }
  retry(user: string, id: string) {
    return this.transaction(() => {
      const row = this.raw(user, id);
      if (!["failed", "interrupted"].includes(row.status)) throw new WorkflowError("Only failed or interrupted jobs can be retried.", 409);
      const current = this.db.prepare("select revision from workflow_campaigns where user_id=? and campaign_id=?").get(user, row.campaign_id);
      if (current?.revision !== row.revision) throw new WorkflowError("The campaign changed after this job; submit a new command instead.", 409);
      const active = this.activeJob(user, row.campaign_id);
      if (active) throw new WorkflowError("This campaign already has an active job.", 409);
      this.db.prepare("update workflow_jobs set status='queued',worker=null,pause_requested=0,message='Explicit retry queued.',updated_at=? where id=?").run(new Date().toISOString(), id);
      return this.get(user, id);
    });
  }
}
