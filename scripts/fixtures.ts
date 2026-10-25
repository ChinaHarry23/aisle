import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

export type Seen = { method: string; url: string; headers: IncomingMessage["headers"]; body: string };
export async function serve(handler: (req: Seen, res: ServerResponse) => unknown) {
  const seen: Seen[] = [];
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const entry = { method: req.method ?? "GET", url: req.url ?? "/", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
    seen.push(entry);
    try { await handler(entry, res); } catch (error) { res.writeHead(500).end(String(error)); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  return { server, seen, origin: `http://127.0.0.1:${address.port}` };
}
export const json = (res: ServerResponse, status: number, body: unknown) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
export function mp4(seconds: number) {
  const ftyp = Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from("ftypisom"), Buffer.from([0, 0, 2, 0])]);
  const mvhd = Buffer.alloc(108);
  mvhd.writeUInt32BE(108, 0); mvhd.write("mvhd", 4, "latin1");
  mvhd.writeUInt32BE(1000, 20); mvhd.writeUInt32BE(Math.round(seconds * 1000), 24);
  const moov = Buffer.alloc(8); moov.writeUInt32BE(116, 0); moov.write("moov", 4, "latin1");
  return Buffer.concat([ftyp, moov, mvhd]);
}

const require = createRequire(import.meta.url);
/** Transpile a TSX component into `dir` and import it. `modules` are bare packages resolved from node_modules; `files` map an import specifier to a repo-relative source file. */
export async function compileComponent(sourcePath: string, dir: string, { modules = [], files = {} }: { modules?: string[]; files?: Record<string, string> }) {
  let compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const specifier of modules) compiled = compiled.replaceAll(`from "${specifier}"`, `from "${pathToFileURL(require.resolve(specifier)).href}"`);
  for (const [specifier, file] of Object.entries(files)) compiled = compiled.replaceAll(`from "${specifier}"`, `from "${pathToFileURL(path.resolve(file)).href}"`);
  const moduleFile = path.join(dir, path.basename(sourcePath).replace(/\.tsx$/, ".mjs"));
  writeFileSync(moduleFile, compiled);
  return import(pathToFileURL(moduleFile).href);
}
