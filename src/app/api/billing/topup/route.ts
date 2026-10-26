import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { publicOrigin } from "@/lib/auth/oauth";
import { billingFor, isUnlimited } from "@/lib/billing/meter";
import { CREDIT_PACK } from "@/lib/billing/plan";
import { StripeApiError, StripeNotConfiguredError, createTopupCheckoutSession, topupConfigured } from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Start a one-time Checkout for the credit pack. Credits land from the webhook. */
export async function POST(request: Request) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (isUnlimited(billingFor(session))) {
    return NextResponse.json({ error: "Team desks are unlimited; there is nothing to buy." }, { status: 400 });
  }
  if (!topupConfigured()) {
    return NextResponse.json(
      { error: "Card checkout is not set up on this server yet. The owner needs to set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET." },
      { status: 503 },
    );
  }

  try {
    const next = await createTopupCheckoutSession(
      { id: session.id, email: session.email, name: session.name },
      publicOrigin(request),
    );
    return NextResponse.json({ url: next.url, credits: CREDIT_PACK.credits, priceUsd: CREDIT_PACK.priceUsd });
  } catch (error) {
    if (error instanceof StripeNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    const message = error instanceof StripeApiError ? error.message : "Could not reach Stripe.";
    console.error(`[billing] topup: ${message}`);
    return NextResponse.json({ error: `Checkout could not start: ${message}` }, { status: 502 });
  }
}
