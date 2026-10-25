/**
 * Fetching a page from a URL a user typed, without letting it reach this
 * server's own network.
 *
 * Every address is checked when the socket connects (the `lookup` hook), so a
 * DNS answer that changes between a check and the request cannot slip
 * through. Redirects are followed by hand and each hop is checked the same way.
 */

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { pipeline } from "node:stream";
import zlib from "node:zlib";

export class PrivateAddressError extends Error {
  constructor() {
    super("Use the public website, not a private or local address.");
    this.name = "PrivateAddressError";
  }
}

function ipv4IsPublic(ip: string): boolean {
  const [a, b, c] = ip.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127) return false; // this network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local, including cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // protocol assignments, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  return a < 224; // multicast, reserved and broadcast
}

/** The eight 16-bit groups of an IPv6 address, or null when it does not parse. */
function hextets(ip: string): number[] | null {
  let text = ip;
  const dotted = text.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) {
    const [, a, b, c, d] = dotted.map(Number);
    text = `${text.slice(0, -dotted[0].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

function embeddedIpv4(groups: number[]) {
  return `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
}

/** True only for a globally routable unicast address. */
export function isPublicAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").replace(/%.*$/, "").toLowerCase();
  const kind = isIP(ip);
  if (kind === 4) return ipv4IsPublic(ip);
  if (kind !== 6) return false;
  const g = hextets(ip);
  if (!g) return false;
  const zeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeroTo(5) && g[5] === 0xffff) return ipv4IsPublic(embeddedIpv4(g)); // IPv4-mapped
  if (zeroTo(4) && g[4] === 0xffff && g[5] === 0) return ipv4IsPublic(embeddedIpv4(g)); // IPv4-translated (SIIT)
  if (zeroTo(6)) return false; // unspecified, loopback and IPv4-compatible
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
    return ipv4IsPublic(embeddedIpv4(g)); // NAT64
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return false; // local-use NAT64
  if (g[0] === 0x2002) {
    // 6to4 carries an IPv4 address in the second and third groups.
    return ipv4IsPublic(`${g[1] >> 8}.${g[1] & 255}.${g[2] >> 8}.${g[2] & 255}`);
  }
  if (g[0] === 0x2001 && g[1] === 0) return false; // Teredo
  if ((g[0] & 0xe000) !== 0x2000) return false; // outside global unicast 2000::/3
  if ((g[0] & 0xfff0) === 0x3ff0) return false; // documentation 3fff::/20
  if (g[0] === 0x2001 && g[1] === 0x0002 && g[2] === 0) return false; // benchmarking 2001:2::/48
  if (g[0] === 0x2001 && ((g[1] & 0xfff0) === 0x0010 || (g[1] & 0xfff0) === 0x0020)) return false; // ORCHID
  if ((g[0] & 0xfe00) === 0xfc00) return false; // unique local
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return false; // link-local, site-local
  if ((g[0] & 0xff00) === 0xff00) return false; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return false; // discard
  return true;
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** dns.lookup that refuses to hand a private address to the socket. */
function publicLookup(hostname: string, options: { all?: boolean; family?: number | string }, callback: LookupCallback) {
  dnsLookup(hostname, { ...options, all: true } as Parameters<typeof dnsLookup>[1] & { all: true }, (error, found) => {
    if (error) return callback(error, "");
    const addresses = found as unknown as LookupAddress[];
    if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) {
      return callback(Object.assign(new PrivateAddressError(), { code: "EPRIVATEADDRESS" }), "");
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

function checkUrl(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("The website must start with http:// or https://.");
  if (url.username || url.password) throw new Error("Leave the user name and password out of the address.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // A literal address never reaches the lookup hook, so it is checked here.
  if (isIP(host) && !isPublicAddress(host)) throw new PrivateAddressError();
}

type PublicPage = { status: number; url: URL; text: string };

function requestOnce(
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
  maxBytes: number,
): Promise<{ status: number; location?: string; text: string }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      url,
      { method: "GET", headers: { ...headers, "Accept-Encoding": "gzip, deflate, br" }, lookup: publicLookup as never, signal },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          return resolve({ status, location: response.headers.location, text: "" });
        }
        const encoding = String(response.headers["content-encoding"] ?? "").toLowerCase();
        const decoder =
          encoding === "gzip" ? zlib.createGunzip()
          : encoding === "deflate" ? zlib.createInflate()
          : encoding === "br" ? zlib.createBrotliDecompress()
          : null;
        const stream = decoder ?? response;
        const chunks: Buffer[] = [];
        let size = 0;
        let done = false;
        // Tear down both streams: a decoder left running would keep expanding
        // a compression bomb after this promise settles.
        const stop = () => {
          response.destroy();
          decoder?.destroy();
        };
        const fail = (error: unknown) => {
          if (done) return;
          done = true;
          stop();
          reject(error);
        };
        const finish = () => {
          if (done) return;
          done = true;
          stop();
          resolve({ status, text: Buffer.concat(chunks).toString("utf8").slice(0, maxBytes) });
        };
        if (decoder) pipeline(response, decoder, (error) => (error ? fail(error) : undefined));
        stream.on("data", (chunk: Buffer) => {
          if (done) return;
          chunks.push(chunk);
          size += chunk.length;
          // Enough to read the page head; stop downloading and decoding the rest.
          if (size >= maxBytes) finish();
        });
        stream.on("end", finish);
        stream.on("error", fail);
        signal.addEventListener("abort", () => fail(signal.reason ?? new Error("The website took too long to answer.")), { once: true });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

/**
 * GET a public page as text. Refuses private, loopback, link-local and
 * metadata addresses on the first request and on every redirect.
 */
export async function fetchPublicText(
  start: URL,
  options: { headers?: Record<string, string>; timeoutMs: number; maxBytes: number; maxRedirects?: number },
): Promise<PublicPage> {
  const signal = AbortSignal.timeout(options.timeoutMs);
  let current = start;
  for (let hop = 0; hop <= (options.maxRedirects ?? 5); hop++) {
    checkUrl(current);
    let page;
    try {
      page = await requestOnce(current, options.headers ?? {}, signal, options.maxBytes);
    } catch (error) {
      if (error instanceof PrivateAddressError) throw new PrivateAddressError();
      throw error;
    }
    if (!page.location) return { status: page.status, url: current, text: page.text };
    current = new URL(page.location, current);
  }
  throw new Error("The website redirected too many times.");
}
