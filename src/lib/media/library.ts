/**
 * Generated pictures and clips belong to the account, not to one campaign draft.
 *
 * A revision replaces the creative on the campaign. The bytes were already stored
 * for that account; this catalogue is what keeps the take browsable afterwards.
 * Removing an item hides it here. The file is deleted only when no campaign
 * still points at it.
 */
import type { Campaign } from "@/lib/types";
import type { ComplianceAttempt, ComplianceIssue } from "@/lib/runtime/types";
import { getDatabase } from "@/lib/db";
import { deleteStoredMedia, isStoredMediaUrl, STORED_PREFIX } from "./store";

export type AssetReview = "approved" | "rejected" | "sent_back" | "needs_review" | "earlier" | "unlinked";

export type LibraryAsset = {
  id: string;
  kind: "image" | "video";
  mime: string;
  mediaUrl: string;
  campaignId: string | null;
  campaignName: string | null;
  product: string | null;
  label: string;
  prompt: string | null;
  modelName: string | null;
  createdAt: string;
  /** Dollars from the provider usage block. Null when this take was saved before cost was recorded. */
  costUsd: number | null;
  /** True when the provider did not return usage and the figure is the catalogue estimate. */
  costEstimated: boolean | null;
  inputTokens: number | null;
  outputTokens: number | null;
  review: AssetReview;
  reasons: string[];
};

type AssetRow = {
  id: string;
  kind: string;
  media_url: string;
  mime: string;
  campaign_id: string | null;
  campaign_name: string | null;
  product: string | null;
  label: string | null;
  prompt: string | null;
  model_name: string | null;
  created_at: string;
  removed_at: string | null;
  cost_usd: number | null;
  cost_estimated: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  creative_id: string | null;
};

const CREATE = `
create table if not exists account_assets (
  id text primary key,
  owner_user_id text not null,
  kind text not null,
  media_url text not null,
  mime text not null,
  campaign_id text,
  campaign_name text,
  product text,
  label text,
  prompt text,
  model_id text,
  model_name text,
  creative_id text,
  created_at text not null,
  removed_at text
);
create index if not exists account_assets_owner_idx on account_assets (owner_user_id, created_at);
`;

let ready: Promise<void> | null = null;

function ensureTable() {
  ready ??= (async () => {
    const db = await getDatabase();
    for (const statement of CREATE.split(";").map((part) => part.trim()).filter(Boolean)) {
      await db.execute(statement);
    }
    for (const statement of [
      "alter table account_assets add column cost_usd real",
      "alter table account_assets add column cost_estimated integer",
      "alter table account_assets add column input_tokens integer",
      "alter table account_assets add column output_tokens integer",
    ]) {
      try {
        await db.execute(statement);
      } catch {
        // Column already exists.
      }
    }
  })().catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}

function shaOf(url: string): string | null {
  if (!isStoredMediaUrl(url)) return null;
  const sha = url.slice(STORED_PREFIX.length);
  return /^[a-f0-9]{64}$/.test(sha) ? sha : null;
}

function assetId(creativeId: string, sha: string) {
  return `gen:${creativeId}:${sha.slice(0, 16)}`;
}

function keptId(sha: string) {
  return `kept:${sha}`;
}

export async function rememberAsset(input: {
  ownerId: string;
  kind: "image" | "video";
  mediaUrl: string;
  mime: string;
  campaignId?: string | null;
  campaignName?: string | null;
  product?: string | null;
  label: string;
  prompt?: string | null;
  modelId?: string | null;
  modelName?: string | null;
  creativeId: string;
  createdAt?: string;
  costUsd?: number | null;
  costEstimated?: boolean | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}) {
  const sha = shaOf(input.mediaUrl);
  if (!sha || !input.ownerId) return;
  await ensureTable();
  const db = await getDatabase();
  await db.execute(
    `insert into account_assets (
      id, owner_user_id, kind, media_url, mime, campaign_id, campaign_name, product,
      label, prompt, model_id, model_name, creative_id, created_at, removed_at,
      cost_usd, cost_estimated, input_tokens, output_tokens
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, null, $15, $16, $17, $18)
    on conflict (id) do update set
      cost_usd = coalesce(account_assets.cost_usd, excluded.cost_usd),
      cost_estimated = coalesce(account_assets.cost_estimated, excluded.cost_estimated),
      input_tokens = coalesce(account_assets.input_tokens, excluded.input_tokens),
      output_tokens = coalesce(account_assets.output_tokens, excluded.output_tokens),
      campaign_id = coalesce(account_assets.campaign_id, excluded.campaign_id),
      campaign_name = coalesce(account_assets.campaign_name, excluded.campaign_name),
      product = coalesce(account_assets.product, excluded.product),
      label = case when account_assets.label in ('Saved image', 'Saved video') then excluded.label else account_assets.label end`,
    [
      assetId(input.creativeId, sha),
      input.ownerId,
      input.kind,
      input.mediaUrl,
      input.mime,
      input.campaignId ?? null,
      input.campaignName ?? null,
      input.product ?? null,
      input.label.slice(0, 240),
      input.prompt?.slice(0, 1500) ?? null,
      input.modelId ?? null,
      input.modelName ?? null,
      input.creativeId,
      input.createdAt ?? new Date().toISOString(),
      input.costUsd ?? null,
      input.costEstimated == null ? null : input.costEstimated ? 1 : 0,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
    ],
  );
}

async function insertKept(ownerId: string, sha: string, kind: string, mime: string, createdAt: string) {
  const db = await getDatabase();
  await db.execute(
    `insert into account_assets (
      id, owner_user_id, kind, media_url, mime, campaign_id, campaign_name, product,
      label, prompt, model_id, model_name, creative_id, created_at, removed_at
    ) values ($1, $2, $3, $4, $5, null, null, null, $6, null, null, null, null, $7, null)
    on conflict (id) do nothing`,
    [keptId(sha), ownerId, kind === "video" ? "video" : "image", `${STORED_PREFIX}${sha}`, mime, kind === "video" ? "Saved video" : "Saved image", createdAt],
  );
}

/** Pull posters already on this account's campaigns, and any stored file not yet catalogued. */
export async function indexAccountAssets(ownerId: string, campaigns: Campaign[]) {
  await ensureTable();
  const db = await getDatabase();
  for (const campaign of campaigns) {
    const shots = [
      ...campaign.creatives.map((creative) => ({
        id: creative.id,
        kind: "image" as const,
        generation: creative.generation,
        label: creative.headline,
      })),
      ...(campaign.videos ?? []).map((video) => ({
        id: video.id,
        kind: "video" as const,
        generation: video.generation,
        label: video.title,
      })),
    ];
    for (const shot of shots) {
      const url = shot.generation?.status === "ok" ? shot.generation.url : null;
      const sha = url ? shaOf(url) : null;
      if (!sha || !url) continue;
      await rememberAsset({
        ownerId,
        kind: shot.kind,
        mediaUrl: url,
        mime: shot.kind === "video" ? "video/mp4" : "image/jpeg",
        campaignId: campaign.id,
        campaignName: campaign.name,
        product: campaign.product,
        label: shot.label,
        modelId: shot.generation?.modelId,
        modelName: shot.generation?.modelName,
        creativeId: shot.id,
        createdAt: shot.generation?.at,
        costUsd: shot.generation?.usage.costUsd,
        costEstimated: shot.generation?.usage.estimate,
        inputTokens: shot.generation?.usage.inputTokens,
        outputTokens: shot.generation?.usage.outputTokens,
      });
    }
  }

  const known = await db.query<{ media_url: string }>(
    "select media_url from account_assets where owner_user_id = $1",
    [ownerId],
  );
  const seen = new Set(known.map((row) => row.media_url));
  const stored = await db.query<{ id: string; kind: string; mime: string; created_at: string }>(
    "select id, kind, mime, created_at from media_objects where owner_user_id = $1",
    [ownerId],
  );
  for (const row of stored) {
    const sha = row.id.slice(0, 64);
    if (!/^[a-f0-9]{64}$/.test(sha)) continue;
    const url = `${STORED_PREFIX}${sha}`;
    if (seen.has(url)) continue;
    await insertKept(ownerId, sha, row.kind, row.mime, row.created_at);
    seen.add(url);
  }
}

function toAsset(row: AssetRow, review: AssetReview, reasons: string[]): LibraryAsset {
  return {
    id: row.id,
    kind: row.kind === "video" ? "video" : "image",
    mime: row.mime,
    mediaUrl: row.media_url,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    product: row.product,
    label: row.label || "Saved image",
    prompt: row.prompt,
    modelName: row.model_name,
    createdAt: row.created_at,
    costUsd: typeof row.cost_usd === "number" ? row.cost_usd : null,
    costEstimated: row.cost_estimated == null ? null : row.cost_estimated === 1,
    inputTokens: typeof row.input_tokens === "number" ? row.input_tokens : null,
    outputTokens: typeof row.output_tokens === "number" ? row.output_tokens : null,
    review,
    reasons,
  };
}

function issuesFor(attempt: ComplianceAttempt, creativeId: string | null): ComplianceIssue[] {
  if (!creativeId) return attempt.issues;
  const specific = attempt.issues.filter(
    (issue) => issue.excerpt.startsWith(creativeId),
  );
  return specific.length > 0 ? specific : attempt.issues;
}

function reasonLines(issues: ComplianceIssue[]) {
  return issues.map((issue) => `${issue.category.replace(/_/g, " ")}: ${issue.explanation}`);
}

function reviewOf(row: AssetRow, campaign: Campaign | undefined): { review: AssetReview; reasons: string[] } {
  if (!campaign) return { review: "unlinked", reasons: [] };
  const creativeId = row.creative_id;
  const current =
    (creativeId != null && campaign.creatives.some((creative) => creative.id === creativeId)) ||
    (creativeId != null && (campaign.videos ?? []).some((video) => video.id === creativeId));
  const attempt = creativeId
    ? [...(campaign.complianceAttempts ?? [])].reverse().find((item) => item.creativeIds?.includes(creativeId))
    : undefined;
  const reasons = attempt ? reasonLines(issuesFor(attempt, creativeId)) : [];
  const decision = campaign.founderDecision;

  if (decision?.action === "reject" && (current || !attempt)) {
    const note = decision.note?.trim();
    return { review: "rejected", reasons: [note ? `You rejected it: ${note}` : "You rejected this campaign.", ...reasons] };
  }
  if (decision?.action === "approve" && current) return { review: "approved", reasons: [] };
  if (decision?.action === "changes" && current) {
    const note = decision.note?.trim();
    return { review: "sent_back", reasons: [note ? `You sent it back: ${note}` : "You asked for changes.", ...reasons] };
  }
  if (attempt?.outcome === "changes_required") {
    return { review: "sent_back", reasons: reasons.length > 0 ? reasons : [attempt.summary] };
  }
  if (attempt?.outcome === "manual_review" || (current && campaign.status === "awaiting_approval")) {
    return { review: "needs_review", reasons };
  }
  if (!current) return { review: "earlier", reasons };
  if (campaign.status === "published" || campaign.status === "scheduled") return { review: "approved", reasons: [] };
  return { review: "needs_review", reasons };
}

const ASSET_COLUMNS = `id, kind, media_url, mime, campaign_id, campaign_name, product, label, prompt, model_name,
  creative_id, created_at, removed_at, cost_usd, cost_estimated, input_tokens, output_tokens`;

export async function listAssets(ownerId: string, campaigns: Campaign[] = []): Promise<LibraryAsset[]> {
  await ensureTable();
  const db = await getDatabase();
  const rows = await db.query<AssetRow>(
    `select ${ASSET_COLUMNS}
     from account_assets where owner_user_id = $1 and removed_at is null
     order by created_at desc`,
    [ownerId],
  );
  const byCampaign = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  return rows.map((row) => {
    const judged = reviewOf(row, row.campaign_id ? byCampaign.get(row.campaign_id) : undefined);
    return toAsset(row, judged.review, judged.reasons);
  });
}

export async function readAsset(ownerId: string, id: string): Promise<LibraryAsset | null> {
  await ensureTable();
  const db = await getDatabase();
  const rows = await db.query<AssetRow>(
    `select ${ASSET_COLUMNS}
     from account_assets where id = $1 and owner_user_id = $2 and removed_at is null`,
    [id, ownerId],
  );
  return rows[0] ? toAsset(rows[0], "unlinked", []) : null;
}

export async function removeAsset(ownerId: string, id: string, campaigns: Campaign[]): Promise<boolean> {
  await ensureTable();
  const db = await getDatabase();
  const rows = await db.query<{ media_url: string }>(
    "select media_url from account_assets where id = $1 and owner_user_id = $2 and removed_at is null",
    [id, ownerId],
  );
  const url = rows[0]?.media_url;
  if (!url) return false;
  await db.execute(
    "update account_assets set removed_at = $1 where id = $2 and owner_user_id = $3",
    [new Date().toISOString(), id, ownerId],
  );
  const stillListed = await db.query<{ id: string }>(
    "select id from account_assets where owner_user_id = $1 and media_url = $2 and removed_at is null",
    [ownerId, url],
  );
  const stillOnCampaign = campaigns.some((campaign) =>
    campaign.creatives.some((creative) => creative.generation?.url === url) ||
    (campaign.videos ?? []).some((video) => video.generation?.url === url),
  );
  if (stillListed.length === 0 && !stillOnCampaign) await deleteStoredMedia(url, ownerId);
  return true;
}
