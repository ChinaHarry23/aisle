import { NextResponse } from "next/server";
import { StripeSignatureError, stripeEnv, verifyStripeSignature } from "@/lib/billing/stripe";
import { handleStripeEvent } from "@/lib/billing/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook. Public in the proxy; the signature is the authentication.
 *
 * 400 for a bad signature (Stripe will not fix that by retrying), 500 when
 * processing fails or the secret is missing (so it retries), 200 for
 * everything else — including events Aisle does not act on.
 */
export async function POST(request: Request) {
  // The raw text, before any parsing: the signature covers the exact bytes.
  const raw = await request.text();
  const secrets = stripeEnv().webhookSecrets;
  if (!secrets.length) {
    // A server misconfiguration, not a bad request: 500 keeps Stripe retrying
    // until the owner sets the secret, so no payment is lost.
    console.error("[stripe] STRIPE_WEBHOOK_SECRET is not set; refusing the event.");
    return NextResponse.json({ error: "Webhook secret is not configured." }, { status: 500 });
  }
  let event;
  try {
    event = verifyStripeSignature(raw, request.headers.get("stripe-signature"), secrets);
  } catch (error) {
    const message = error instanceof StripeSignatureError ? error.message : "Invalid webhook.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  try {
    const outcome = await handleStripeEvent(event);
    return NextResponse.json({ received: true, ...outcome });
  } catch (error) {
    console.error(`[stripe] ${event.type} ${event.id} failed:`, error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Processing failed; Stripe will retry." }, { status: 500 });
  }
}
