import { get, put } from "@vercel/blob";

const PREFIX = "aisle-auth/";

function pathname(key: string) {
  return `${PREFIX}${key}.json`;
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const result = await get(pathname(key), { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  const text = await new Response(result.stream).text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

export async function kvSet(key: string, value: unknown) {
  await put(pathname(key), JSON.stringify(value), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}
