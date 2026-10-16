import { getCurrentUser } from "@/lib/auth/current";
import { listWorkflowJobs, workflowEnabled } from "@/lib/workflow/gateway";
import { WorkflowError } from "@/lib/workflow/commands";

export const runtime = "nodejs";
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!workflowEnabled()) return Response.json({ enabled: false, jobs: [], worker: { online: false, lastSeen: null } });
  try { return Response.json({ enabled: true, ...await listWorkflowJobs(user.id) }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Workflow unavailable." }, { status: error instanceof WorkflowError ? error.status : 503 }); }
}
