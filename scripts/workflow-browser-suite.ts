import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { blankCampaign, defaultBrand } from "../src/lib/seed";
import { defaultSettings } from "../src/lib/settings";

const modulePath = process.env.PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await import(modulePath);
const dir = mkdtempSync(path.join(os.tmpdir(), "aisle-browser-test-"));
const base = "http://127.0.0.1:4183";
const env = { ...process.env, AUTH_SECRET: randomBytes(32).toString("hex"), AISLE_DB: "sqlite", AISLE_DB_FILE: path.join(dir, "accounts.db"), AISLE_WORKFLOW_DB: path.join(dir, "workflow.db"), AISLE_WORKFLOW_PORT: "4171", AISLE_WORKFLOW_URL: "http://127.0.0.1:4171", AISLE_WORKFLOW_SECRET: randomBytes(32).toString("hex"), NEXT_TELEMETRY_DISABLED: "1" };
const children: ChildProcess[] = [];
let logs = "";
function start(args: string[]) {
  const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  for (const stream of [child.stdout, child.stderr]) stream?.on("data", data => { logs = (logs + data).slice(-12_000); });
  return child;
}
async function ready(url: string) {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Startup failed: ${logs}`);
}
start(["--import", "./scripts/service-loader.mjs", "--experimental-strip-types", "services/workflow/api.ts", "--serve"]);
start(["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "4183"]);
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  await Promise.all([ready(`${base}/signup`), ready("http://127.0.0.1:4171/health")]);
  const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1050 } });
  const request = context.request;
  const signup = await request.post("/api/auth/signup", { data: { name: "Workflow Tester", email: "workflow-test@example.test", password: randomBytes(16).toString("hex") } });
  assert.equal(signup.status(), 200, await signup.text());
  const settings = defaultSettings();
  const campaign = blankCampaign({ name: "Browser closure proof", product: "Cold-pressed olive oil", category: "Pantry", targetAudience: "Australian home cooks", objective: "Increase store visits", budget: 3000, channels: ["web", "email"], startDate: "2026-10-01", endDate: "2026-10-15", country: "AU", notes: "Isolated browser acceptance test" }, defaultBrand, null, settings);
  assert.equal((await request.put("/api/workspace", { data: { brand: defaultBrand, settings, campaigns: [campaign] } })).status(), 200);
  const page = await context.newPage();
  await page.goto(`${base}/operations`);
  await page.getByRole("heading", { name: "Work continues off-screen." }).waitFor();
  const response = await request.post("/api/engine", { data: { campaign, command: { type: "START", actor: "founder" }, requestId: "browser-proof-1" } });
  assert.equal(response.status(), 202, await response.text());
  const { job } = await response.json();
  await page.close();
  const worker = start(["--import", "./scripts/service-loader.mjs", "--experimental-strip-types", "scripts/workflow-suite.ts", "--fixture-worker"]);
  const [code] = await once(worker, "exit");
  assert.equal(code, 0, logs);
  const jobResponse = await request.get(`/api/engine/jobs/${job.id}`);
  assert.equal(jobResponse.status(), 200);
  const completed = await jobResponse.json();
  assert.equal(completed.status, "completed", completed.message);
  assert.equal(completed.result.campaign.status, "awaiting_approval");
  // A stale browser save may edit the workspace, but must not reset worker-owned progress.
  assert.equal((await request.put("/api/workspace", { data: { brand: defaultBrand, settings, campaigns: [{ ...campaign, founderDecision: { action: "approve", note: "forged" } }] } })).status(), 200);
  const workspace = await (await request.get("/api/workspace")).json();
  const saved = workspace.campaigns.find((c: {id: string}) => c.id === campaign.id);
  assert.equal(saved.status, "awaiting_approval"); assert.equal(saved.founderDecision, null);
  const unauthorized = await request.post("/api/engine", { data: { campaign, command: { type: "PUBLISH", actor: "media" }, requestId: "forged-agent" } });
  assert.equal(unauthorized.status(), 403);
  const resumed = await context.newPage();
  const errors: string[] = [];
  resumed.on("pageerror", (e: Error) => errors.push(e.message));
  await resumed.goto(`${base}/operations`);
  await resumed.getByRole("cell", { name: "completed", exact: true }).waitFor();
  await resumed.getByText("Browser closure proof", { exact: true }).waitFor();
  await resumed.screenshot({ path: path.join(dir, "operations-desktop.png"), fullPage: true });
  await resumed.setViewportSize({ width: 390, height: 844 });
  await resumed.screenshot({ path: path.join(dir, "operations-mobile.png"), fullPage: true });
  assert.deepEqual(errors, []);
  const other = await browser.newContext({ baseURL: base });
  await other.request.post("/api/auth/signup", { data: { name: "Other Tester", email: "other-test@example.test", password: randomBytes(16).toString("hex") } });
  assert.equal((await other.request.get(`/api/engine/jobs/${job.id}`)).status(), 404);
  console.log(JSON.stringify({ result: "PASS", proof: ["signup and session", "real Next-to-workflow HTTP gateway", "browser closed before worker execution", "approval gate survives worker exit", "stale/forged workspace save rejected by authoritative overlay", "agent publish rejected", "cross-user job denied", "operations desktop/mobile rendered without JS errors"], artifacts: dir }, null, 2));
} finally {
  await browser.close();
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  await Promise.all(children.filter(child => child.exitCode === null).map(child => Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(() => { child.kill("SIGKILL"); resolve(null); }, 4000))])));
}
