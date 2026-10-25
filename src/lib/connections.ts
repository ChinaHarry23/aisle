import { getByoKey } from "./media/byo-key";
import type { ProviderId } from "./media/types";

export type ConnectionKind = "llm" | "image";

/** workspace: key in the server env. device: key pasted in this browser. endpoint: a URL, no key (local). */
export type ConnectionState = "workspace" | "device" | "endpoint" | "none";

export type ConnectionTestResult = { ok: boolean; message: string; ms: number };

export type ServerStatus = { llm: Record<string, boolean>; media: Record<string, boolean> };

/** Providers with a free authenticated call we can use to check a key. */
const TESTABLE: Record<ConnectionKind, string[]> = {
  llm: ["openai", "anthropic", "local"],
  image: ["openai"],
};

export function canTest(kind: ConnectionKind, providerId: string) {
  return TESTABLE[kind].includes(providerId);
}

/** DOM id of a provider's row on the Connections tab. */
export function rowId(kind: ConnectionKind, providerId: string) {
  return `conn-${kind}-${providerId}`;
}

export function connectionState(
  kind: ConnectionKind,
  providerId: string,
  status: ServerStatus | null,
  deviceKeys: Record<string, boolean>,
): ConnectionState {
  if (kind === "llm" && providerId === "local") return "endpoint";
  const server = kind === "llm" ? status?.llm[providerId] : status?.media[providerId];
  if (server) return "workspace";
  if (kind === "image" && deviceKeys[providerId]) return "device";
  return "none";
}

export const isConnected = (s: ConnectionState) => s !== "none";

export function readDeviceKeys(providers: ProviderId[]): Record<string, boolean> {
  return Object.fromEntries(providers.map((p) => [p, Boolean(getByoKey(p))]));
}

export async function testConnection(
  kind: ConnectionKind,
  providerId: string,
  opts: { key?: string; baseUrl?: string } = {},
): Promise<ConnectionTestResult> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.key) headers["x-provider-key"] = opts.key;
    const res = await fetch("/api/settings/test", {
      method: "POST",
      headers,
      body: JSON.stringify({ kind, providerId, baseUrl: opts.baseUrl }),
    });
    if (!res.ok) return { ok: false, message: "The test could not be run.", ms: 0 };
    return (await res.json()) as ConnectionTestResult;
  } catch {
    return { ok: false, message: "The test could not be run.", ms: 0 };
  }
}
