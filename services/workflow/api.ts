import { createServer, type IncomingMessage } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WorkflowRepository } from "./repository";
import { WorkflowError } from "../../src/lib/workflow/commands";
import type { WorkflowSubmission } from "../../src/lib/workflow/types";
import type { StudioMediaUpdate } from "../../src/lib/media/persistence";

async function body(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2_000_000) throw new WorkflowError("Request exceeds 2 MB.", 413);
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw new WorkflowError("Malformed JSON."); }
}

export function createWorkflowServer(repo: WorkflowRepository, secret: string) {
  if (secret.length < 32) throw new Error("AISLE_WORKFLOW_SECRET must contain at least 32 characters.");
  return createServer(async (req, res) => {
    const send = (status: number, data: unknown) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url || "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/health") return send(200, { service: "aisle-workflow", storage: "sqlite-wal", worker: repo.workerStatus() });
      const expected = Buffer.from(`Bearer ${secret}`), supplied = Buffer.from(String(req.headers.authorization || ""));
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new WorkflowError("Service authentication required.", 401);
      const user = req.headers["x-aisle-user"];
      if (typeof user !== "string" || !user || user.length > 150) throw new WorkflowError("A verified workspace owner is required.", 401);
      repo.recoverExpired();
      if (url.pathname === "/campaigns" && req.method === "GET") return send(200, repo.campaigns(user));
      const media = url.pathname.match(/^\/campaigns\/([a-zA-Z0-9_-]{1,150})\/media$/);
      if (media && req.method === "POST") return send(200, repo.saveMedia(user, media[1], await body(req) as StudioMediaUpdate));
      if (url.pathname === "/jobs" && req.method === "GET") return send(200, { jobs: repo.list(user), worker: repo.workerStatus() });
      if (url.pathname === "/jobs" && req.method === "POST") {
        const input = await body(req) as WorkflowSubmission;
        return send(202, repo.enqueue(user, String(req.headers["idempotency-key"] || ""), input));
      }
      const match = url.pathname.match(/^\/jobs\/([a-zA-Z0-9-]+)(\/retry)?$/);
      if (match && !match[2] && req.method === "GET") return send(200, repo.get(user, match[1]));
      if (match?.[2] && req.method === "POST") return send(202, repo.retry(user, match[1]));
      throw new WorkflowError("Not found.", 404);
    } catch (error) {
      const known = error instanceof WorkflowError;
      send(known ? error.status : 500, { error: known ? error.message : "Workflow storage or execution request failed." });
    }
  });
}

if (process.argv.includes("--serve")) {
  const repo = new WorkflowRepository();
  const server = createWorkflowServer(repo, process.env.AISLE_WORKFLOW_SECRET || "");
  server.listen(Number(process.env.AISLE_WORKFLOW_PORT || 4171), "127.0.0.1", () => console.log("Workflow API ready on loopback."));
  const stop = () => server.close(() => { repo.close(); process.exit(0); });
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}
