import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { publicOrigin } from "@/lib/auth/oauth";
import { findUserById } from "@/lib/auth/users";
import { billingFor, isUnlimited } from "@/lib/billing/meter";
import { StripeApiError, StripeNotConfiguredError, checkoutConfigured } from "@/lib/billing/stripe";
import { checkoutOrPortal } from "@/lib/billing/summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Start the $10/month subscription. Someone already subscribed gets the portal instead. */
export async function POST(request: Request) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const user = await findUserById(session.id);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  // Only desks that really are unlimited here; a hosted desk not on AISLE_UNLIMITED_USERS pays like anyone.
  if (isUnlimited(billingFor(user))) {
    return NextResponse.json({ error: "Team desks are unlimited; there is nothing to subscribe to." }, { status: 400 });
  }
  if (!checkoutConfigured()) {
    return NextResponse.json(
      { error: "Billing is not set up on this server yet. The owner needs to set STRIPE_SECRET_KEY and STRIPE_PRICE_ID." },
      { status: 503 },
    );
  }

  try {
    const next = await checkoutOrPortal({ id: user.id, email: user.email, name: user.name }, publicOrigin(request));
    return NextResponse.json(next);
  } catch (error) {
    if (error instanceof StripeNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    const message = error instanceof StripeApiError ? error.message : "Could not reach Stripe.";
    console.error(`[billing] checkout: ${message}`);
    return NextResponse.json({ error: `Checkout could not start: ${message}` }, { status: 502 });
  }
}
