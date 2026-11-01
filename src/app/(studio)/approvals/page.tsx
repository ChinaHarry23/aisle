"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ReviewQueue } from "@/components/approvals/ReviewQueue";
import { PageHeader, SectionTitle } from "@/components/ui";
import { approvalsHref, parseReviewType, reviewQueue, reviewTypes, type ReviewType } from "@/lib/approvals/queue";
import { useActiveCampaigns } from "@/lib/store";

export default function ApprovalsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-mute">Loading reviews…</p>}>
      <ApprovalsInbox />
    </Suspense>
  );
}

function ApprovalsInbox() {
  const campaigns = useActiveCampaigns();
  const searchParams = useSearchParams();
  const router = useRouter();
  const type = parseReviewType(searchParams.get("type"));
  const total = reviewQueue(campaigns).length;
  const setType = (next: ReviewType | "all") => {
    router.replace(approvalsHref(next), { scroll: false });
  };
  const heading =
    type === "all"
      ? total > 0
        ? `${total} waiting on you`
        : "Human review"
      : `${reviewTypes.find((item) => item.id === type)?.label ?? "Review"}`;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Approvals"
        title="Decisions waiting on you"
        description="Compliance, trend research, distribution channel conflicts, and any other decision the agents cannot settle are listed here. Nothing is published until you decide."
      />

      <div className="flex flex-col gap-6">
        <SectionTitle kicker="Manual review" title={heading} />
        <ReviewQueue campaigns={campaigns} type={type} onType={setType} />
      </div>
    </div>
  );
}
