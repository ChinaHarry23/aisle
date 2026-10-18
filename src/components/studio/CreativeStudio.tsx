"use client";

import { AdWorkbench } from "@/components/studio/AdWorkbench";
import { formatUsd } from "@/lib/ids";
import { posterPrompt } from "@/lib/media/prompts";
import { studioSpend, withStudioDefaults } from "@/lib/media/spend";
import type { Campaign } from "@/lib/types";
import Link from "next/link";

export function CreativeStudio({ campaign }: { campaign?: Campaign }) {
  const c = campaign ? withStudioDefaults(campaign) : null;
  const spend = c ? studioSpend(c) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="max-w-xl text-sm text-ink-soft">
            Generate here. Models live in{" "}
            <Link href="/settings" className="text-signal hover:underline">
              Settings
            </Link>
            .
          </p>
        </div>
        {spend ? (
          <p className="text-sm tabular-nums text-mute">
            This campaign studio · {formatUsd(spend.total)}
          </p>
        ) : (
          <p className="text-sm text-mute">Standalone · no campaign attached</p>
        )}
      </div>

      <AdWorkbench
        key={c?.id ?? "standalone"}
        defaultPrompt={c?.creatives[0] ? posterPrompt(c, c.creatives[0]) : ""}
        referenceImages={c?.productImageUrl ? [c.productImageUrl] : []}
      />
    </div>
  );
}
