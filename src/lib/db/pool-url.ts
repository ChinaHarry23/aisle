/**
 * Neon serves a transaction-pooled hostname beside the direct one.
 * Serverless instances should use the pooler so a cold start does not open a
 * new database backend. Schema changes still go to the direct host.
 */
export function preferPooledPostgresUrl(url: string): string {
  if (process.env.AISLE_DB_DIRECT === "1") return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!parsed.hostname.endsWith(".neon.tech")) return url;
  const [endpoint, ...rest] = parsed.hostname.split(".");
  if (!endpoint || endpoint.includes("-pooler") || rest.length < 2) return url;
  parsed.hostname = `${endpoint}-pooler.${rest.join(".")}`;
  return parsed.toString();
}
