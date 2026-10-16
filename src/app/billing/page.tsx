import { BillingView } from "@/components/billing/BillingView";

export const dynamic = "force-dynamic";

/** Stripe sends people back here with ?checkout=success or ?checkout=cancel. */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const raw = (await searchParams).checkout;
  const checkout = raw === "success" || raw === "cancel" ? raw : null;
  return <BillingView checkout={checkout} />;
}
