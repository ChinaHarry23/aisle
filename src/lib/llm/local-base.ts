import { isIP } from "node:net";
import { isHosted } from "@/lib/billing/hosted";
import { fetchGuarded, PrivateAddressError } from "@/lib/net/public-fetch";

/**
 * Which local OpenAI-compatible server a request may reach.
 *
 * The URL comes from the account's settings, so without this check any
 * signed-in user could make the server POST to an internal address and read
 * part of the reply back from the run log.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Names that resolve to someone else's loopback or to a cloud metadata address. */
const REBIND_SUFFIXES = [".nip.io", ".sslip.io", ".xip.io", ".localtest.me", ".lvh.me", ".local", ".internal", ".localhost", ".localdomain"];

function normaliseBase(url: string) {
  return url.trim().replace(/\/+$/, "");
}

function localProbePorts(): string[] {
  const custom = process.env.LOCAL_LLM_PROBE_URLS;
  if (custom !== undefined) return custom.split(",").map((item) => item.trim()).filter(Boolean);
  // The default ports are for a laptop. A hosted server only trusts what the
  // owner set explicitly.
  if (isHosted()) return [];
  return ["http://127.0.0.1:8000/v1", "http://127.0.0.1:1234/v1", "http://127.0.0.1:11434/v1"];
}

/** The local servers this server itself is configured to use. */
function configuredLocalBases(): string[] {
  return [process.env.LOCAL_LLM_BASE_URL, ...localProbePorts()]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(normaliseBase);
}

function hostOf(hostname: string) {
  return hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

/** An https name on the public internet. Literal addresses and rebinding names are refused here; DNS is checked again when the request is sent. */
function publicHttpsHost(hostname: string) {
  const host = hostOf(hostname);
  if (!host || isIP(host) || host === "localhost" || host === "metadata.google.internal") return false;
  return !REBIND_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix));
}

/**
 * A user-supplied model URL is allowed when the server already names it
 * (LOCAL_LLM_BASE_URL or a probe port), when a private install points it at
 * loopback, or when it is https on a public hostname (an ngrok tunnel or
 * another OpenAI-compatible host). Private addresses, link-local, and cloud
 * metadata stay refused. Returns the normalised URL, or null when it is refused.
 */
export function allowedLocalBase(url?: string | null) {
  if (!url?.trim()) return null;
  const wanted = normaliseBase(url);
  if (configuredLocalBases().includes(wanted)) return wanted;
  let parsed: URL;
  try {
    parsed = new URL(wanted);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  const host = hostOf(parsed.hostname);
  if (!isHosted() && LOOPBACK_HOSTS.has(host)) return normaliseBase(`${parsed.origin}${parsed.pathname}`);
  if (parsed.protocol === "https:" && publicHttpsHost(parsed.hostname)) return normaliseBase(`${parsed.origin}${parsed.pathname}`);
  return null;
}

/** What a refused URL tells the founder, in the run log and on Settings. */
export function refusedLocalBaseMessage() {
  return isHosted()
    ? "This address is not allowed on the hosted site. Use an https URL on the public internet, such as your ngrok tunnel, or set LOCAL_LLM_BASE_URL on the server for a local model."
    : "Local model URLs must point at this machine (localhost, 127.0.0.1 or [::1]), or use https on the public internet. Set LOCAL_LLM_BASE_URL on the server to use another address.";
}

/** POST or GET the OpenAI-compatible server. A public host is resolved through the private-address guard; ngrok's browser warning is skipped. */
export async function fetchLocalModel(
  base: string,
  path: string,
  init: { method?: "GET" | "POST"; body?: string; timeoutMs?: number } = {},
) {
  const url = new URL(path.replace(/^\//, ""), base.endsWith("/") ? base : `${base}/`);
  const host = hostOf(url.hostname);
  const headers: Record<string, string> = {};
  if (init.body) headers["Content-Type"] = "application/json";
  if (host.endsWith(".ngrok-free.app") || host.endsWith(".ngrok-free.dev") || host.endsWith(".ngrok.app") || host.endsWith(".ngrok.io")) {
    headers["ngrok-skip-browser-warning"] = "true";
  }
  try {
    return await fetchGuarded(url.toString(), {
      method: init.method ?? "GET",
      headers,
      body: init.body,
      timeoutMs: init.timeoutMs ?? (LOOPBACK_HOSTS.has(host) ? 2_500 : 20_000),
    });
  } catch (error) {
    if (error instanceof PrivateAddressError) {
      throw new Error("That host resolves to a private address, so Aisle will not call it.");
    }
    throw error;
  }
}
