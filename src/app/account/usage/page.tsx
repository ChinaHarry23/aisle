import { UsageView } from "@/components/billing/UsageView";

/** Stripe sends people back here with ?checkout=success or ?checkout=cancel. */
export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const raw = (await searchParams).checkout;
  const checkout = raw === "success" || raw === "cancel" ? raw : null;
  return <UsageView checkout={checkout} />;
}
