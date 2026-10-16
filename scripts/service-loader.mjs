import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Services and tests execute the same TypeScript modules as the Next.js bundle.
const root = process.cwd();
register(`data:text/javascript,${encodeURIComponent(`
import { pathToFileURL, fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';
const root = ${JSON.stringify(root)};
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/') || (specifier.startsWith('.') && context.parentURL?.startsWith('file:'))) {
    const base = specifier.startsWith('@/') ? path.join(root, 'src', specifier.slice(2)) : path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    for (const candidate of [base, base + '.ts', base + '.js', path.join(base, 'index.ts')]) {
      if (existsSync(candidate) && /\\.(ts|js|mjs)$/.test(candidate)) return next(pathToFileURL(candidate).href, context);
    }
  }
  return next(specifier, context);
}
`)}`, pathToFileURL(root + '/'));
