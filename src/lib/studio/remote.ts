/**
 * Run the campaign bench on the Agent Server.
 *
 * Studio can draw a graph only when an Agent Server is serving it. Traces from
 * the Next.js process land in the `aisle` project, and that project has no
 * graph. Sending the desk's command to the local `operation` graph makes the
 * same thread the drawing and the trace.
 */

import { createHash } from "node:crypto";
import type { Command } from "@/lib/runtime/types";

const LOCAL_GRAPH_URL = "http://127.0.0.1:2024";
const PROBE_MS = 15_000;

export class GraphRequestError extends Error {
  readonly network: boolean;

  constructor(message: string, network: boolean) {
    super(message);
    this.name = "GraphRequestError";
    this.network = network;
  }
}

/** Stable thread id so one campaign is one Studio thread. */
export function operationThreadId(campaignId: string): string {
  const hex = createHash("sha256").update(`aisle.operation:${campaignId}`).digest("hex");
  const clock = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${clock}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

/** Where Studio draws the server named by `graphServerUrl`. */
function studioOrigin(): string {
  const explicit = process.env.LANGSMITH_STUDIO_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const endpoint = process.env.LANGSMITH_ENDPOINT ?? "";
  if (endpoint.includes("apac.")) return "https://apac.smith.langchain.com";
  if (endpoint.includes("eu.")) return "https://eu.smith.langchain.com";
  return "https://smith.langchain.com";
}

export function studioHref(baseUrl: string, threadId?: string): string {
  const params = new URLSearchParams({ baseUrl });
  const origin = studioOrigin();
  if (!threadId) return `${origin}/studio/?${params}`;
  return `${origin}/studio/thread/${threadId}?${params}`;
}

/** The campaign thread when it already exists, otherwise the server's graph list. */
export async function studioHrefForCampaign(baseUrl: string, campaignId: string): Promise<string> {
  const threadId = operationThreadId(campaignId);
  try {
    const response = await fetch(`${baseUrl}/threads/${threadId}`, { signal: AbortSignal.timeout(400) });
    if (response.ok) return studioHref(baseUrl, threadId);
  } catch {
    // The server already answered /ok. A missing thread just opens the graph list.
  }
  return studioHref(baseUrl);
}

/**
 * The Agent Server to run on.
 *
 * `AISLE_GRAPH_URL=off` keeps the desk in-process. A URL always wins. In local
 * development the default is the `npm run studio` server; production stays
 * in-process until a URL is set.
 */
export function graphServerUrl(): string | null {
  const raw = process.env.AISLE_GRAPH_URL?.trim();
  if (raw === "0" || raw === "off" || raw === "false") return null;
  if (raw) return raw.replace(/\/$/, "");
  if (process.env.NODE_ENV === "development") return LOCAL_GRAPH_URL;
  return null;
}

export function readGraphOutcome(values: unknown): { canAdvance: boolean; message: string } {
  if (!values || typeof values !== "object") return { canAdvance: false, message: "" };
  const record = values as Record<string, unknown>;
  return {
    canAdvance: record.canAdvance === true,
    message: typeof record.message === "string" ? record.message : "",
  };
}

/** `/runs/wait` returns HTTP 200 with `__error__` when the graph throws. */
export function readGraphFailure(values: unknown): string | null {
  if (!values || typeof values !== "object" || !("__error__" in values)) return null;
  const wrapped = (values as { __error__?: unknown }).__error__;
  if (!wrapped || typeof wrapped !== "object") return "The operation graph failed.";
  const record = wrapped as { message?: unknown; error?: unknown };
  const message = typeof record.message === "string" ? record.message.trim() : "";
  if (message.startsWith("{")) {
    try {
      const inner = JSON.parse(message) as { message?: unknown };
      if (typeof inner.message === "string" && inner.message.trim()) return inner.message.trim();
    } catch {
      // The message is a plain string that happens to start with a brace.
    }
  }
  if (message) return message;
  return typeof record.error === "string" && record.error.trim()
    ? record.error.trim()
    : "The operation graph failed.";
}

let probe: { url: string; ok: boolean; at: number } | null = null;

function forgetOperationGraph() {
  probe = null;
}

async function ping(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/ok`, { signal: AbortSignal.timeout(400) });
    return response.ok;
  } catch {
    return false;
  }
}

/** The server when it is configured and answering. Cached briefly so a launch does not probe twice. */
export async function reachableOperationGraph(): Promise<string | null> {
  const url = graphServerUrl();
  if (!url) return null;
  const now = Date.now();
  if (probe && probe.url === url && now - probe.at < PROBE_MS) return probe.ok ? url : null;
  const ok = await ping(url);
  probe = { url, ok, at: now };
  return ok ? url : null;
}

async function errorText(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const json = JSON.parse(text) as { detail?: unknown; message?: unknown };
    const detail = json.detail ?? json.message;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (detail != null) return JSON.stringify(detail);
  } catch {
    // The body was not JSON.
  }
  return text.trim().slice(0, 500) || `The operation graph returned ${response.status}.`;
}

/**
 * One founder command on the `operation` graph.
 *
 * The campaign must already be saved. Hydrate reads it, the nodes are the
 * bench, and the server writes the campaign back.
 */
export async function invokeOperationGraph(input: {
  url: string;
  campaignId: string;
  userId: string;
  maxSteps: number;
  command: Command;
}): Promise<{ canAdvance: boolean; message: string }> {
  const threadId = operationThreadId(input.campaignId);
  const url = input.url.replace(/\/$/, "");
  let response: Response;
  try {
    await fetch(`${url}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        thread_id: threadId,
        if_exists: "do_nothing",
        metadata: { campaignId: input.campaignId, graph_id: "operation" },
      }),
    });
    response = await fetch(`${url}/threads/${threadId}/runs/wait`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assistant_id: "operation",
        if_not_exists: "create",
        metadata: { campaignId: input.campaignId, command: input.command.type, source: "aisle" },
        input: {
          campaignId: input.campaignId,
          userId: input.userId,
          maxSteps: input.maxSteps,
          command: input.command,
        },
      }),
    });
  } catch (error) {
    forgetOperationGraph();
    const message = error instanceof Error ? error.message : "The operation graph is unreachable.";
    throw new GraphRequestError(message, true);
  }
  if (!response.ok) {
    throw new GraphRequestError(await errorText(response), false);
  }
  const raw = (await response.text()).trim();
  let values: unknown;
  try {
    values = raw ? JSON.parse(raw) : null;
  } catch {
    throw new GraphRequestError(raw.slice(0, 500) || "The operation graph returned an unreadable result.", false);
  }
  const failure = readGraphFailure(values);
  if (failure) throw new GraphRequestError(failure, false);
  return readGraphOutcome(values);
}
