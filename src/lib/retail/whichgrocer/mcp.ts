/**
 * Client for the WhichGrocer remote MCP connector.
 *
 * https://mcp.whichgrocer.com/mcp speaks streamable HTTP and requires the
 * OAuth bearer token from a WhichGrocer sign-in. Tool names are read from
 * `tools/list` so a rename on their side does not silently price the wrong call.
 */

import { offersFromPayload, toolResultIsError, type ShelfOffer } from "./query";

export const WHICHGROCER_MCP_URL = "https://mcp.whichgrocer.com/mcp";
const PROTOCOL = "2025-03-26";
const RPC_TIMEOUT_MS = 12_000;

export class WhichGrocerAuthError extends Error {
  constructor(message = "WhichGrocer sign-in expired.") {
    super(message);
    this.name = "WhichGrocerAuthError";
  }
}

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: {
    properties?: Record<string, { type?: string }>;
    required?: string[];
  };
};

type RpcResult = { result?: unknown; error?: { message?: string } };

const SEARCH_NAMES = ["search_products", "searchProducts", "products_search", "search_product"];
const EQUIVALENT_NAMES = [
  "get_product_equivalents",
  "list_equivalents",
  "product_equivalents",
  "get_equivalents",
  "getProductEquivalents",
];

export function argumentsFor(
  schema: McpTool["inputSchema"] | undefined,
  values: Record<string, string | number>,
): Record<string, string | number> {
  const properties = schema?.properties;
  if (!properties || Object.keys(properties).length === 0) return { ...values };
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(values)) {
    if (key in properties) out[key] = value;
  }
  return out;
}

export function searchArguments(schema: McpTool["inputSchema"] | undefined, query: string): Record<string, string | number> | null {
  const keys = Object.keys(schema?.properties ?? {});
  if (keys.length === 0) return { q: query };
  const queryKey = ["q", "query", "term", "name", "search"].find((key) => keys.includes(key));
  if (!queryKey) return null;
  return argumentsFor(schema, { [queryKey]: query, page: 1, page_size: 15, pageSize: 15, limit: 15 });
}

export function equivalentArguments(
  schema: McpTool["inputSchema"] | undefined,
  productId: string,
): Record<string, string | number> | null {
  const keys = Object.keys(schema?.properties ?? {});
  if (keys.length === 0) return { id: productId };
  const idKey = ["id", "product_id", "productId"].find((key) => keys.includes(key));
  if (!idKey) return null;
  return argumentsFor(schema, { [idKey]: productId, stores: "coles,woolworths,aldi" });
}

function pickNamed(tools: McpTool[], names: string[], matches: (blob: string) => boolean): McpTool | undefined {
  const exact = names.map((name) => tools.find((tool) => tool.name === name)).find(Boolean);
  if (exact) return exact;
  return tools.find((tool) => matches(`${tool.name} ${tool.description ?? ""}`.toLowerCase()));
}

async function readRpc(response: Response): Promise<RpcResult | null> {
  if (response.status === 401) throw new WhichGrocerAuthError();
  const text = await response.text();
  if (!response.ok) {
    const reason = text.replace(/\s+/g, " ").slice(0, 160);
    throw new Error(reason || `HTTP ${response.status}`);
  }
  if (!text.trim()) return null;
  const type = response.headers.get("content-type") ?? "";
  const body = type.includes("text/event-stream")
    ? text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter(Boolean)
        .at(-1)
    : text;
  if (!body) return null;
  try {
    return JSON.parse(body) as RpcResult;
  } catch {
    throw new Error("WhichGrocer returned a response that was not JSON.");
  }
}

export class WhichGrocerMcp {
  private sessionId: string | null = null;
  private tools: McpTool[] | null = null;
  private nextId = 1;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(token: string, fetchImpl: typeof fetch = fetch) {
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  private async rpc(method: string, params?: unknown, notify = false): Promise<RpcResult | null> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": PROTOCOL,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    const message: Record<string, unknown> = { jsonrpc: "2.0", method };
    if (!notify) message.id = this.nextId++;
    if (params !== undefined) message.params = params;
    const response = await this.fetchImpl(WHICHGROCER_MCP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      cache: "no-store",
    });
    const session = response.headers.get("mcp-session-id");
    if (session) this.sessionId = session;
    const parsed = await readRpc(response);
    if (parsed?.error) throw new Error(parsed.error.message || "WhichGrocer rejected the request.");
    return parsed;
  }

  async start(): Promise<void> {
    await this.rpc("initialize", {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: "Aisle", version: "0.2" },
    });
    await this.rpc("notifications/initialized", undefined, true);
  }

  async listTools(): Promise<McpTool[]> {
    if (this.tools) return this.tools;
    const listed: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const parsed = await this.rpc("tools/list", cursor ? { cursor } : {});
      const result = parsed?.result;
      if (!result || typeof result !== "object") break;
      const record = result as { tools?: McpTool[]; nextCursor?: string };
      listed.push(...(record.tools ?? []));
      cursor = record.nextCursor;
      if (!cursor) break;
    }
    this.tools = listed;
    return listed;
  }

  async call(name: string, args: Record<string, string | number>): Promise<unknown> {
    const parsed = await this.rpc("tools/call", { name, arguments: args });
    return parsed?.result ?? null;
  }

  async search(query: string): Promise<{ offers: ShelfOffer[]; tool: string }> {
    await this.start();
    const tools = await this.listTools();
    const search = pickNamed(
      tools,
      SEARCH_NAMES,
      (blob) => /search/.test(blob) && /product/.test(blob),
    );
    if (!search) {
      const names = tools.map((tool) => tool.name).slice(0, 12).join(", ") || "none";
      throw new Error(`WhichGrocer did not offer a product search tool (${names}).`);
    }
    const args = searchArguments(search.inputSchema, query);
    if (!args) throw new Error(`WhichGrocer search tool ${search.name} has no query argument.`);
    const result = await this.call(search.name, args);
    const failure = toolResultIsError(result);
    if (failure) throw new Error(failure);
    let offers = offersFromPayload(result);

    const stores = new Set(offers.map((offer) => offer.store));
    const equivalents = pickNamed(tools, EQUIVALENT_NAMES, (blob) => /equivalent/.test(blob));
    const anchor = offers.find((offer) => offer.id && !offer.id.includes(":"));
    if (equivalents && anchor && stores.size < 2) {
      const equivalentArgs = equivalentArguments(equivalents.inputSchema, anchor.id);
      if (equivalentArgs) {
        try {
          const compared = await this.call(equivalents.name, equivalentArgs);
          if (!toolResultIsError(compared)) {
            const extra = offersFromPayload(compared);
            if (extra.length > 0) offers = extra;
          }
        } catch (error) {
          if (error instanceof WhichGrocerAuthError) throw error;
        }
      }
    }
    return { offers, tool: search.name };
  }
}
