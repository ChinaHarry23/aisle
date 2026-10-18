/**
 * Plain-fetch plumbing shared by the media adapters: timeouts, error text,
 * bounded polling, capped downloads. Keys only ever travel in headers, and a
 * download only carries the key to the provider's own API origin.
 */

type ProviderErrorOptions = { status?: number; code?: string; retryable?: boolean; billable?: boolean };

export class ProviderError extends Error {
  readonly status?: number;
  readonly code?: string;
  /** False for refusals such as a moderation block: asking again will not help. */
  readonly retryable: boolean;
  /**
   * True when the job was already accepted and the provider may still bill it
   * (deadline passed, polling or the download failed after success). The
   * credit hold is then settled, not released. Never set for a status the
   * provider reports as failed, cancelled or moderated: those are not billed.
   */
  readonly billable: boolean;
  constructor(message: string, options: ProviderErrorOptions = {}) {
    super(message);
    this.name = "ProviderError";
    this.status = options.status;
    this.code = options.code;
    this.retryable = options.retryable ?? (options.status === undefined || options.status >= 500 || options.status === 429);
    this.billable = options.billable ?? false;
  }
}

/**
 * Run the part of a job that comes after the provider accepted it. Any failure
 * in here is rethrown as billable, because the render may exist and be billed
 * even though Aisle never got the bytes.
 */
export async function afterSubmit<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ProviderError && error.billable) throw error;
    const stopped = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    const message = stopped ? "Aisle stopped waiting before the provider finished." : error instanceof Error ? error.message : "Provider error";
    throw new ProviderError(message, {
      status: error instanceof ProviderError ? error.status : undefined,
      code: error instanceof ProviderError ? error.code : undefined,
      retryable: false,
      billable: true,
    });
  }
}

/** Rate-limit codes sent with a 4xx (TokenHub 1302/1303) or in a body (ModelArk, DashScope). */
const RATE_LIMIT_CODE = /^(1302|1303)$|RateLimit|Throttling|ServerOverloaded|RequestBurstTooFast|RESOURCE_EXHAUSTED|rate_limit/i;
/** Out of balance or paused by the owner: waiting will not help. TokenHub sends these as 429s. */
const HARD_STOP_CODE = /^(1100|1101|1102)$|SetLimitExceeded|AccountOverdue|Arrearage/i;

/**
 * Worth asking again: a 429, a 5xx, a provider rate-limit code, or a network
 * error or timeout. Decided from the status and code, since some adapters
 * rewrite `retryable` for their own messages.
 */
export function transientError(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return false;
  if (error.code && HARD_STOP_CODE.test(error.code)) return false;
  if (error.code && RATE_LIMIT_CODE.test(error.code)) return true;
  // No status: the request never got an answer (network, timeout, unreadable body).
  if (error.status === undefined) return error.retryable;
  return error.status === 429 || error.status >= 500;
}

/**
 * One poll or download, retried on transient errors with exponential backoff
 * (2 s, 4 s, 8 s… capped at 30 s and at the time left before `deadline`).
 * A refusal or other permanent error is rethrown at once, and so is anything
 * once the caller's signal has fired.
 */
export async function pollJson<T>(
  fetchOnce: () => Promise<T>,
  options: { deadline: number; signal?: AbortSignal; attempts?: number },
): Promise<T> {
  const attempts = options.attempts ?? 5;
  let backoff = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchOnce();
    } catch (error) {
      if (options.signal?.aborted || !transientError(error) || attempt >= attempts) throw error;
      const left = options.deadline - Date.now();
      if (left <= 0) throw error;
      backoff = Math.min(backoff ? backoff * 2 : pollInterval(2000), 30_000, left);
      await sleep(backoff, options.signal);
    }
  }
}

/**
 * Deadline for one async video job, from before the create call until polling
 * stops: 8 min, so create + polling + a 3 min download fit in about 720 s,
 * inside Studio's 800 s function. AISLE_MEDIA_JOB_MS shortens it for offline tests.
 */
export function videoJobMs() {
  const override = Number(process.env.AISLE_MEDIA_JOB_MS);
  return Number.isFinite(override) && override > 0 ? override : 8 * 60_000;
}

/** Per-request timeout that never runs past the job deadline (at least 1 s). */
export function timeLeft(deadline: number, capMs: number) {
  return Math.max(1_000, Math.min(capMs, deadline - Date.now()));
}

/**
 * Poll an accepted job until `done`, within `deadline`. Transient poll errors
 * are retried; anything that still fails (or the deadline) is billable.
 */
export function pollJob<T>(
  provider: string,
  first: T,
  options: { done: (job: T) => boolean; poll: (timeoutMs: number) => Promise<T>; intervalMs: number; deadline: number; signal?: AbortSignal; what?: string; onDeadline?: () => void },
): Promise<T> {
  return afterSubmit(async () => {
    let job = first;
    while (!options.done(job)) {
      if (Date.now() > options.deadline) {
        options.onDeadline?.();
        throw deadlineError(provider, options.what);
      }
      await sleep(Math.max(0, Math.min(pollInterval(options.intervalMs), options.deadline - Date.now())), options.signal);
      job = await pollJson(() => options.poll(timeLeft(options.deadline, 60_000)), { deadline: options.deadline, signal: options.signal });
    }
    return job;
  });
}

/** Thrown when an accepted job is still running at its deadline: it may finish and be billed. */
export function deadlineError(provider: string, what = "the video") {
  const minutes = videoJobMs() / 60_000;
  return new ProviderError(`${provider} did not finish ${what} within ${minutes >= 1 ? `${Math.round(minutes)} minutes` : `${Math.round(minutes * 60)} seconds`}.`, { retryable: false, billable: true });
}

/** An env entry may be `A|B`: either variable satisfies it. */
export function envValue(entry: string): string | undefined {
  for (const name of entry.split("|")) {
    const value = process.env[name.trim()]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function apiBase(envName: string, fallback: string) {
  return (process.env[envName]?.trim() || fallback).replace(/\/+$/, "");
}

/** Poll interval; AISLE_MEDIA_POLL_MS shortens it for offline tests. */
export function pollInterval(defaultMs: number) {
  const override = Number(process.env.AISLE_MEDIA_POLL_MS);
  return Number.isFinite(override) && override > 0 ? override : defaultMs;
}

export function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(signal!.reason); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function signalFor(timeoutMs: number, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

type ErrorBody = { error?: { message?: string; code?: string | number; type?: string; status?: string } | string };

/** JSON request with a timeout. Non-2xx becomes a ProviderError carrying the provider's own message. */
export async function providerJson<T>(
  provider: string,
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: unknown; form?: FormData; timeoutMs: number; signal?: AbortSignal },
): Promise<T> {
  let response: Response;
  const form = init.form;
  try {
    response = await fetch(url, {
      method: init.method ?? (init.body === undefined && !form ? "GET" : "POST"),
      headers: { ...(form || init.body === undefined ? {} : { "Content-Type": "application/json" }), ...init.headers },
      body: form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
      redirect: "error",
      cache: "no-store",
      signal: signalFor(init.timeoutMs, init.signal),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new ProviderError(timedOut ? `${provider} did not answer in time.` : `${provider} is unreachable.`);
  }
  const text = await response.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* reported below */ }
  if (!response.ok) {
    const err = (json as ErrorBody | null)?.error;
    const message = typeof err === "string" ? err : err?.message;
    const code = typeof err === "object" && err ? String(err.code ?? err.status ?? "") || undefined : undefined;
    throw new ProviderError(`${provider} returned ${response.status}${message ? `: ${message.slice(0, 300)}` : ""}`, { status: response.status, code });
  }
  if (json === null) throw new ProviderError(`${provider} returned an unreadable response.`);
  return json as T;
}

/** Read a body without holding more than `max` bytes. */
export async function readCapped(response: Response, max: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); throw new ProviderError("Generated media exceeds the size limit.", { retryable: false }); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

const LOOPBACK = ["127.0.0.1", "localhost", "[::1]"];

type DownloadOptions = { keyOrigin: string; headers: Record<string, string>; max: number; timeoutMs: number; signal?: AbortSignal };

/**
 * Download a provider file. Redirects are followed by hand so the key header is
 * sent to the provider's API origin only, never to a storage host it redirects to.
 * A transient error gets two more tries, all inside `timeoutMs`.
 */
export function downloadFile(provider: string, uri: string, options: DownloadOptions): Promise<Buffer> {
  const deadline = Date.now() + options.timeoutMs;
  return pollJson(() => downloadOnce(provider, uri, { ...options, timeoutMs: timeLeft(deadline, options.timeoutMs) }), { deadline, signal: options.signal, attempts: 2 });
}

async function downloadOnce(provider: string, uri: string, options: DownloadOptions): Promise<Buffer> {
  const signal = signalFor(options.timeoutMs, options.signal);
  // Plain http is only for the offline tests, whose fake provider itself runs on loopback.
  const testing = LOOPBACK.includes(new URL(options.keyOrigin).hostname);
  let current = new URL(uri);
  for (let hop = 0; hop < 5; hop++) {
    const loopback = testing && LOOPBACK.includes(current.hostname);
    if (current.protocol !== "https:" && !loopback) throw new ProviderError(`${provider} returned an insecure download link.`, { retryable: false });
    let response: Response;
    try {
      response = await fetch(current, { headers: current.origin === options.keyOrigin ? options.headers : {}, redirect: "manual", cache: "no-store", signal });
    } catch {
      throw new ProviderError(`${provider} download failed.`);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) break;
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new ProviderError(`${provider} download returned ${response.status}.`, { status: response.status }); }
    return readCapped(response, options.max);
  }
  throw new ProviderError(`${provider} download redirected too many times.`);
}

/** Clip length from the MP4 `mvhd` box, or undefined when it cannot be read. */
export function mp4DurationSec(bytes: Buffer): number | undefined {
  const at = bytes.indexOf("mvhd", 0, "latin1");
  if (at < 4 || at + 32 > bytes.length) return undefined;
  const version = bytes[at + 4];
  const timescale = version === 1 ? bytes.readUInt32BE(at + 24) : bytes.readUInt32BE(at + 16);
  const duration = version === 1 ? Number(bytes.readBigUInt64BE(at + 28)) : bytes.readUInt32BE(at + 20);
  if (!timescale || !Number.isFinite(duration) || duration <= 0) return undefined;
  return Math.round((duration / timescale) * 100) / 100;
}

/** Round a USD cost to a hundredth of a cent. */
export const roundUsd = (usd: number) => Math.round(usd * 10000) / 10000;
