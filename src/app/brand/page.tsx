"use client";

import Link from "next/link";
import { useAisle } from "@/lib/store";
import type { Country } from "@/lib/types";

const countries: Country[] = ["AU", "NZ", "UK", "US"];

export default function BrandPage() {
  const brand = useAisle((s) => s.brand);
  const updateBrand = useAisle((s) => s.updateBrand);
  const resetDemo = useAisle((s) => s.resetDemo);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header>
        <p className="text-[11px] uppercase tracking-[0.2em] text-signal">Brand-aware generation</p>
        <h1 className="font-serif text-4xl">{brand.retailerName}</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Creative and Compliance both read this file. Model backends live in{" "}
          <Link href="/settings" className="text-signal hover:underline">
            Settings
          </Link>{" "}
          — this page is brand voice and legal language only.
        </p>
      </header>

      <label className="block">
        <span className="text-[11px] uppercase tracking-wider text-mute">Retailer</span>
        <input
          value={brand.retailerName}
          onChange={(e) => updateBrand({ retailerName: e.target.value })}
          className="mt-1 w-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
        />
      </label>
      <label className="block">
        <span className="text-[11px] uppercase tracking-wider text-mute">Tagline</span>
        <input
          value={brand.tagline}
          onChange={(e) => updateBrand({ tagline: e.target.value })}
          className="mt-1 w-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
        />
      </label>
      <label className="block">
        <span className="text-[11px] uppercase tracking-wider text-mute">Tone of voice</span>
        <textarea
          rows={3}
          value={brand.tone}
          onChange={(e) => updateBrand({ tone: e.target.value })}
          className="mt-1 w-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
        />
      </label>
      <label className="block">
        <span className="text-[11px] uppercase tracking-wider text-mute">Visual style</span>
        <textarea
          rows={3}
          value={brand.visualStyle}
          onChange={(e) => updateBrand({ visualStyle: e.target.value })}
          className="mt-1 w-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
        />
      </label>
      <label className="block">
        <span className="text-[11px] uppercase tracking-wider text-mute">Approved terms (comma-separated)</span>
        <input
          value={brand.approvedTerms.join(", ")}
          onChange={(e) =>
            updateBrand({
              approvedTerms: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
            })
          }
          className="mt-1 w-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
        />
      </label>
      <label className="block">
        <span className="text-[11px] uppercase tracking-wider text-mute">Banned terms (comma-separated)</span>
        <input
          value={brand.bannedTerms.join(", ")}
          onChange={(e) =>
            updateBrand({
              bannedTerms: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
            })
          }
          className="mt-1 w-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
        />
      </label>

      <div>
        <p className="text-[11px] uppercase tracking-wider text-mute">Country compliance profiles</p>
        <ul className="mt-2 flex flex-col gap-3">
          {countries.map((c) => (
            <li key={c}>
              <p className="text-xs font-medium">{c}</p>
              <textarea
                rows={3}
                value={brand.countryRules[c]}
                onChange={(e) =>
                  updateBrand({
                    countryRules: { ...brand.countryRules, [c]: e.target.value },
                  })
                }
                className="mt-1 w-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
              />
            </li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        onClick={() => {
          if (confirm("Reset campaigns and brand to the demo seed?")) resetDemo();
        }}
        className="self-start text-sm text-mute underline hover:text-ink"
      >
        Reset demo data
      </button>
    </div>
  );
}
