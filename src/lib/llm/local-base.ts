import { isHosted } from "@/lib/billing/hosted";

/**
 * Which local OpenAI-compatible server a request may reach.
 *
 * The URL comes from the account's settings, so without this check any
 * signed-in user could make the server POST to an internal address and read
 * part of the reply back from the run log.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

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

/**
 * A user-supplied local base URL is allowed only when the server already
 * names it (LOCAL_LLM_BASE_URL or a probe port), or, on a private install,
 * when it is http(s) to loopback with no credentials, query or fragment.
 * Returns the normalised URL, or null when it is refused.
 */
export function allowedLocalBase(url?: string | null) {
  if (!url?.trim()) return null;
  const wanted = normaliseBase(url);
  if (configuredLocalBases().includes(wanted)) return wanted;
  if (isHosted()) return null;
  let parsed: URL;
  try {
    parsed = new URL(wanted);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  return normaliseBase(`${parsed.origin}${parsed.pathname}`);
}

/** What a refused URL tells the founder, in the run log and on Settings. */
export function refusedLocalBaseMessage() {
  return isHosted()
    ? "This local model URL is not allowed on a hosted install. Set LOCAL_LLM_BASE_URL on the server to use a local model."
    : "Local model URLs must point at this machine (localhost, 127.0.0.1 or [::1]). Set LOCAL_LLM_BASE_URL on the server to use another address.";
}
