import { LLM_MODELS } from "@/lib/llm/catalog";
import { MEDIA_MODELS } from "@/lib/media/catalog";
import type { ConnectionTestResult } from "@/lib/connections";
import { allowedLocalBase, fetchLocalModel, refusedLocalBaseMessage } from "@/lib/llm/local-base";

type Body = { kind?: "llm" | "image"; providerId?: string; baseUrl?: string };

const TIMEOUT_MS = 6_000;

function fail(message: string, ms: number): ConnectionTestResult {
  return { ok: false, message, ms };
}

/** Provider error bodies can quote part of the key, so only the status ever reaches the client. */
function explain(status: number): string {
  if (status === 401) return "The provider rejected this key.";
  if (status === 403) return "The key is valid but not allowed to list models.";
  if (status === 429) return "Rate limited. The key looks valid; try again shortly.";
  return `The provider answered with status ${status}.`;
}

async function probe(url: string, headers: Record<string, string>): Promise<ConnectionTestResult> {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const ms = Date.now() - started;
    if (res.ok) return { ok: true, message: "Connected.", ms };
    if (res.status === 429) return { ok: true, message: explain(429), ms };
    return fail(explain(res.status), ms);
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return fail(timedOut ? "No answer within 6 seconds." : "Could not reach the provider.", Date.now() - started);
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const { kind, providerId } = body;
  if ((kind !== "llm" && kind !== "image") || !providerId) {
    return Response.json({ error: "kind and providerId are required" }, { status: 400 });
  }

  if (kind === "llm" && providerId === "local") {
    const raw = (body.baseUrl || process.env.LOCAL_LLM_BASE_URL || "").trim();
    let base: URL;
    try {
      base = new URL(raw);
    } catch {
      return Response.json(fail("Enter a valid base URL first.", 0));
    }
    if (base.protocol !== "http:" && base.protocol !== "https:") {
      return Response.json(fail("The base URL must start with http:// or https://.", 0));
    }
    // The same check the agents' calls use, so this cannot probe internal hosts.
    const allowed = allowedLocalBase(raw);
    if (!allowed) return Response.json(fail(refusedLocalBaseMessage(), 0));
    const started = Date.now();
    try {
      const result = await fetchLocalModel(allowed, "models", { timeoutMs: 12_000 });
      const ms = Date.now() - started;
      if (result.ok) return Response.json({ ok: true, message: "Endpoint reachable.", ms });
      return Response.json(fail(`${result.status ? `The endpoint answered with status ${result.status}. ` : ""}Is the server running and reachable from where Aisle runs?`, ms));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not reach the endpoint.";
      return Response.json(fail(`${message} Is the server running and reachable from where Aisle runs?`, Date.now() - started));
    }
  }

  const envKeys =
    kind === "llm"
      ? LLM_MODELS.find((m) => m.providerId === providerId)?.envKeys
      : MEDIA_MODELS.find((m) => m.providerId === providerId)?.envKeys;
  if (!envKeys) return Response.json({ error: "Unknown provider" }, { status: 400 });

  const key = req.headers.get("x-provider-key") || process.env[envKeys[0]];
  if (!key) return Response.json(fail("No key to test yet.", 0));

  if (providerId === "openai") {
    return Response.json(await probe("https://api.openai.com/v1/models", { Authorization: `Bearer ${key}` }));
  }
  if (providerId === "anthropic") {
    return Response.json(
      await probe("https://api.anthropic.com/v1/models", {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      }),
    );
  }
  return Response.json({ error: "No connection test for this provider" }, { status: 400 });
}
