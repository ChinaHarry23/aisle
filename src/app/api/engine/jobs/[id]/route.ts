import { getCurrentUser } from "@/lib/auth/current";
import { getWorkflowJob, retryWorkflowJob } from "@/lib/workflow/gateway";
import { WorkflowError } from "@/lib/workflow/commands";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
async function handle(context: Context, retry: boolean) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { id } = await context.params;
    return Response.json(await (retry ? retryWorkflowJob(user.id, id) : getWorkflowJob(user.id, id)));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Workflow unavailable." }, { status: error instanceof WorkflowError ? error.status : 503 });
  }
}
export async function GET(_request: Request, context: Context) { return handle(context, false); }
export async function POST(request: Request, context: Context) {
  const body = await request.json().catch(() => null);
  if (body?.confirmRetry !== true) return Response.json({ error: "Confirm that provider usage was checked before retrying." }, { status: 400 });
  return handle(context, true);
}
