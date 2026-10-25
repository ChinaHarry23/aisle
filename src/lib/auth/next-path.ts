/**
 * Where to send someone after they sign in. Shared by the OAuth routes and the
 * sign-in form, so it imports nothing.
 *
 * Only a path on this site is allowed. Browsers read `/\evil.com` and a path
 * with a tab or newline after the first slash as `//evil.com`, so those are
 * refused, and the result must still resolve to this origin.
 */
const PROBE_ORIGIN = "http://aisle.invalid";

export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  // Backslashes and control characters, which browsers strip or turn into "/".
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return "/";
  let parsed: URL;
  try {
    parsed = new URL(value, PROBE_ORIGIN);
  } catch {
    return "/";
  }
  if (parsed.origin !== PROBE_ORIGIN) return "/";
  // Dot segments collapse during parsing, so "/.//evil.com" becomes "//evil.com".
  if (parsed.pathname.startsWith("//")) return "/";
  // Sending a signed-in user back to a sign-in page only loops.
  if (/^\/(login|signup)(\/|$)/.test(parsed.pathname)) return "/";
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
