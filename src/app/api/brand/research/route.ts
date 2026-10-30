import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { researchBrand } from "@/lib/brand/research";
import { runComplete } from "@/lib/llm/metered-complete";
import { billingForSession } from "@/lib/billing/meter";
import { DEFAULT_LLM } from "@/lib/llm/catalog";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { name?: string; website?: string; modelId?: string } | null;
  if (!body?.name?.trim() || !body.website?.trim()) {
    return NextResponse.json({ error: "Brand name and website are required." }, { status: 400 });
  }
  try {
    const billing = await billingForSession(user);
    const suggestion = await researchBrand({
      name: body.name,
      website: body.website,
      modelId: body.modelId?.trim() || DEFAULT_LLM,
      complete: (req) => runComplete(req, billing),
    });
    return NextResponse.json(suggestion);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The brand site could not be read.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
