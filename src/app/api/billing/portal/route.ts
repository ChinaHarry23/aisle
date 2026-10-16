import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { publicOrigin } from "@/lib/auth/oauth";
import { StripeApiError, StripeNotConfiguredError, openPortal, stripeEnv } from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stripe's Customer Portal: cancel, change card, download invoices. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!stripeEnv().secretKey) {
    return NextResponse.json(
      { error: "Billing is not set up on this server yet. The owner needs to set STRIPE_SECRET_KEY." },
      { status: 503 },
    );
  }
  try {
    // Null when there is no customer, or Stripe no longer has it (the stale link is dropped).
    const portal = await openPortal(user.id, publicOrigin(request));
    if (!portal) {
      return NextResponse.json({ error: "There is no billing account yet. Subscribe first." }, { status: 404 });
    }
    return NextResponse.json({ url: portal.url });
  } catch (error) {
    if (error instanceof StripeNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    const message = error instanceof StripeApiError ? error.message : "Could not reach Stripe.";
    console.error(`[billing] portal: ${message}`);
    return NextResponse.json({ error: `The billing portal could not open: ${message}` }, { status: 502 });
  }
}
