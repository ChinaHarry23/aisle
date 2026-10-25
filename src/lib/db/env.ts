/**
 * Connection-string variables we accept, in priority order.
 *
 * Vercel's storage integrations name their own variables rather than using a
 * convention: the Neon integration can write `DATABASE_URL`, and some setups write
 * `POSTGRES_URL` or a store-prefixed name. Accepting the common spellings means
 * connecting a database in the dashboard is enough, with no code change and no
 * guessing about which variable the provider chose.
 */
export const POSTGRES_URL_VARS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "AISLE_DATABASE_URL",
  "NEON_DATABASE_URL",
  "STORAGE_URL",
] as const;

export function databaseUrl(): { name: string; url: string } | null {
  for (const name of POSTGRES_URL_VARS) {
    const value = process.env[name];
    if (value && /^postgres(ql)?:\/\//.test(value)) return { name, url: value };
  }
  return null;
}
