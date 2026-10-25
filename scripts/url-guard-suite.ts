/**
 * Server-side fetches of URLs a user typed must not reach this server's own
 * network: loopback, private ranges, link-local and cloud metadata, by literal
 * address or by DNS name. Redirects take the same checks on each hop; that
 * path needs a public host, so it is not exercised offline. No network beyond loopback.
 *
 *   npm run test:url-guard
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { fetchPublicText, isPublicAddress, PrivateAddressError } from "../src/lib/net/public-fetch";

const results: string[] = [];
const pass = (name: string) => results.push(name);

{
  const refused = [
    "127.0.0.1", "127.8.9.10", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.5",
    "::", "::1", "[::1]", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::127.0.0.1",
    "64:ff9b:1::a00:1", "2002:7f00:1::1", "3fff::1", "2001:2::1", "2001:10::1", "2001:20::1", "5f00::1", "::1:0:0", "100:0:0:1::1", "2001:0:4136:e378::1", "::ffff:0:7f00:1",
    "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%en0", "ff02::1", "2001:db8::1", "64:ff9b::a9fe:a9fe",
    "not-an-ip", "metadata.google.internal",
  ];
  for (const address of refused) assert.equal(isPublicAddress(address), false, address);
  for (const address of ["1.1.1.1", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::1"]) {
    assert.equal(isPublicAddress(address), true, address);
  }
  pass(`address classes: ${refused.length} private, local or malformed forms refused`);
}

const hits: string[] = [];
const server = createServer((req, res) => {
  hits.push(req.url ?? "");
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<title>internal</title>");
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = (server.address() as { port: number }).port;

try {
  for (const target of [`http://127.0.0.1:${port}/`, `http://[::ffff:7f00:1]:${port}/`, `http://localhost:${port}/`, `http://2130706433:${port}/`]) {
    await assert.rejects(fetchPublicText(new URL(target), { timeoutMs: 3_000, maxBytes: 10_000 }), PrivateAddressError, target);
  }
  assert.equal(hits.length, 0, "no request reached the loopback server");
  pass("literal, mapped, numeric and DNS loopback addresses are refused before any request");

  await assert.rejects(fetchPublicText(new URL("file:///etc/passwd"), { timeoutMs: 1_000, maxBytes: 100 }), /http/);
  await assert.rejects(fetchPublicText(new URL("http://user:pw@example.test/"), { timeoutMs: 1_000, maxBytes: 100 }), /user name/);
  pass("non-http schemes and embedded credentials are refused");
} finally {
  server.close();
}

console.log("\nURL guard suite\n");
for (const name of results) console.log(`  ✓ ${name}`);
console.log(`\n${results.length} checks passed.\n`);
