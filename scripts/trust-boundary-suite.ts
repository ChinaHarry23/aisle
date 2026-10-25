/**
 * What the browser may decide about a campaign, on every path that stores one:
 * PUT /api/workspace, inline /api/engine and the durable queue. Agent results,
 * approvals and run state must come from the server's own copy. No network.
 *
 *   npm run test:trust-boundary
 */

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(os.tmpdir(), "aisle-trust-boundary-"));
for (const name of ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "AISLE_DATABASE_URL", "NEON_DATABASE_URL", "STORAGE_URL"]) delete process.env[name];
process.env.AISLE_DB_FILE = path.join(dir, "accounts.db");

const { WorkflowRepository } = await import("../services/workflow/repository");
const { loadWorkspace, saveWorkspace, updateWorkspace } = await import("../src/lib/auth/workspace");
const { closeDatabase } = await import("../src/lib/db");
import { blankCampaign, defaultBrand } from "../src/lib/seed";
import { defaultSettings } from "../src/lib/settings";
import { acceptWorkspaceCampaigns, founderInput } from "../src/lib/workflow/founder-input";
import type { Campaign, CampaignInput } from "../src/lib/types";

const results: string[] = [];
const pass = (name: string) => results.push(name);
const settings = defaultSettings();
const brief: CampaignInput = {
  name: "Trust boundary",
  product: "Cold-pressed olive oil",
  category: "Pantry",
  targetAudience: "Australian home cooks",
  objective: "Increase store visits",
  budget: 3000,
  channels: ["web", "email"],
  startDate: "2026-10-01",
  endDate: "2026-10-15",
  country: "AU",
  notes: "Fixture",
  unitCostAud: 6.5,
  currentPriceAud: 14,
  productImageUrl: "data:image/png;base64,AAAA",
  imageModelId: "openai:gpt-image-2.5",
  videoModelId: "google:veo-3.1-fast",
  spendCapUsd: 4,
};
const forge = (campaign: Campaign): Campaign => ({
  ...structuredClone(campaign),
  status: "scheduled",
  founderDecision: { action: "approve", note: "forged", at: "2026-10-01T00:00:00.000Z" },
  complianceAttempts: [{ id: "forged" } as never],
  creatives: [{ id: "forged" } as never],
  spend: { inferenceUsd: 0, mediaUsd: 0, capUsd: 999, blockedAttempts: 0 },
  running: true,
});

/* ---------------------------------------------------------- PUT /api/workspace */
{
  const stored = { ...blankCampaign(brief, defaultBrand, null, settings), status: "awaiting_approval" as const };
  const doc = { brand: defaultBrand, settings, campaigns: [stored] };

  const forged = forge(stored);
  forged.archivedAt = "2026-10-02T00:00:00.000Z";
  forged.collectorOverrides = { web: "late", instagram: "ok", email: "bogus" } as never;
  forged.spendCapUsd = 9;
  const [kept] = acceptWorkspaceCampaigns(doc, [forged]);
  assert.equal(kept.status, "awaiting_approval", "status stays the stored one");
  assert.equal(kept.founderDecision, null, "a browser approval is dropped");
  assert.deepEqual(kept.complianceAttempts, stored.complianceAttempts);
  assert.deepEqual(kept.creatives, stored.creatives);
  assert.deepEqual(kept.spend, stored.spend);
  assert.equal(kept.archivedAt, "2026-10-02T00:00:00.000Z", "the founder can trash it");
  assert.equal(kept.running, false);
  assert.deepEqual(kept.collectorOverrides, { web: "late" }, "only its own channels and known outcomes");
  assert.equal(kept.spendCapUsd, 9, "the founder can change the spend cap");

  const [restored] = acceptWorkspaceCampaigns({ ...doc, campaigns: [{ ...stored, archivedAt: "2026-10-02T00:00:00.000Z" }] }, [{ ...stored, archivedAt: null }]);
  assert.equal(restored.archivedAt, null, "and restore it");

  const fresh = forge(blankCampaign(brief, defaultBrand, null, settings));
  const [draft] = acceptWorkspaceCampaigns(doc, [fresh]);
  assert.equal(draft.id, fresh.id);
  assert.equal(draft.status, "draft", "a campaign the server never stored is a draft");
  assert.equal(draft.founderDecision, null);
  assert.deepEqual(draft.creatives, []);
  assert.equal(draft.running, false);
  assert.equal(draft.unitCostAud, 6.5, "the founder's brief is kept");

  assert.equal(acceptWorkspaceCampaigns(doc, [stored, stored, null, { id: "" }]).length, 1, "duplicates and junk are dropped");
  assert.equal(acceptWorkspaceCampaigns(doc, []).length, 0, "leaving a campaign out still deletes it");
  pass("workspace save keeps agent results from the stored copy and takes only founder controls");
}

/* ------------------------------------------------------------ durable queue */
{
  const repo = new WorkflowRepository(":memory:");
  try {
    const draft = blankCampaign(brief, defaultBrand, null, settings);
    repo.enqueue("alice", "start-brief", { campaign: draft, campaigns: [], brand: defaultBrand, settings, command: { type: "START", actor: "founder" } });
    const queued = repo.campaign("alice", draft.id)!;
    for (const key of ["unitCostAud", "currentPriceAud", "productImageUrl", "imageModelId", "videoModelId", "spendCapUsd"] as const) {
      assert.equal(queued[key], brief[key], `durable START keeps ${key}`);
    }
    assert.deepEqual(founderInput(queued), founderInput(draft), "inline and durable modes take the same brief");
    pass("durable START keeps the whole founder brief, the same cut as inline");

    const trashed = blankCampaign(brief, defaultBrand, null, settings);
    const inWorkspace = { ...trashed, archivedAt: "2026-10-02T00:00:00.000Z" };
    assert.throws(
      () => repo.enqueue("alice", "start-trashed", { campaign: trashed, campaigns: [inWorkspace], brand: defaultBrand, settings, command: { type: "START", actor: "founder" } }),
      /in the trash/,
      "a campaign trashed on the workspace cannot be advanced",
    );
    assert.equal(repo.campaign("alice", trashed.id), null, "nothing was queued");
    pass("durable queue refuses a campaign that is in the workspace trash");
  } finally {
    repo.close();
  }
}

/* --------------------------------------------- saves that land mid-update */
{
  const owner = "trust-boundary-owner";
  const base = await loadWorkspace(owner, "beta");
  const draft = blankCampaign(brief, defaultBrand, null, settings);
  await saveWorkspace(owner, { ...base, campaigns: [draft] });

  // An engine result lands between this update's read and its write.
  let attempts = 0;
  const saved = await updateWorkspace(owner, "beta", async (stored) => {
    attempts++;
    if (attempts === 1) {
      const latest = await loadWorkspace(owner, "beta");
      await saveWorkspace(owner, { ...latest, campaigns: latest.campaigns.map((c) => ({ ...c, status: "awaiting_approval" as const })) });
    }
    const accepted = acceptWorkspaceCampaigns(stored, [{ ...draft, archivedAt: "2026-10-03T00:00:00.000Z" }]);
    return { ...stored, campaigns: accepted };
  });
  assert.equal(saved, true);
  assert.equal(attempts, 2, "the first write saw the document had changed and redid the update");
  const after = (await loadWorkspace(owner, "beta")).campaigns.find((c) => c.id === draft.id)!;
  assert.equal(after.status, "awaiting_approval", "the engine result survives");
  assert.equal(after.archivedAt, "2026-10-03T00:00:00.000Z", "and the founder's trash is applied on top");
  pass("a workspace save never undoes a result saved while it was running");
}
await closeDatabase();

console.log("\nTrust boundary suite\n");
for (const name of results) console.log(`  ✓ ${name}`);
console.log(`\n${results.length} checks passed.\n`);
