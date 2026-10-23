"use client";

import { useState } from "react";
import { RetailDataPanel } from "@/components/RetailDataPanel";
import { PageHeader } from "@/components/ui";
import { useAisle } from "@/lib/store";
import type { BrandProfile } from "@/lib/types";

const inputCls = "mt-1 w-full border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-signal";
const labelCls = "text-[11px] uppercase tracking-wider text-mute";

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHsl([r, g, b]: [number, number, number]) {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
  }
  return [Math.round((h * 60 + 360) % 360), Math.round(s * 100), Math.round(l * 100)];
}

function toCmyk([r, g, b]: [number, number, number]) {
  const k = 1 - Math.max(r, g, b) / 255;
  if (k === 1) return [0, 0, 0, 100];
  const c = (v: number) => Math.round(((1 - v / 255 - k) / (1 - k)) * 100);
  return [c(r), c(g), c(b), Math.round(k * 100)];
}

const SCHEME = [
  { key: "signal", name: "Primary" },
  { key: "accent", name: "Accent" },
  { key: "ink", name: "Text" },
  { key: "deep", name: "Dark" },
  { key: "paper", name: "Background" },
] as const;

function ColourScheme({ colors }: { colors: BrandProfile["colors"] }) {
  const rows = SCHEME.flatMap((c) => {
    const hex = colors[c.key];
    return hex ? [{ ...c, hex, rgb: parseHex(hex) }] : [];
  });
  return (
    <section>
      <p className={labelCls}>Colour scheme</p>
      <div className="hairline mt-3 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-mute">
              {["Hex code", "Colour name", "RGB", "HSL", "CMYK"].map((h) => (
                <th key={h} className="px-4 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-line last:border-0">
                <td className="px-4 py-3">
                  <span className="flex items-center gap-3 text-ink">
                    <span className="h-10 w-10 shrink-0 rounded-[10px] border border-line" style={{ background: r.hex }} />
                    <span className="text-xs font-semibold uppercase text-ink">{r.hex}</span>
                  </span>
                </td>
                <td className="px-4 py-3 font-medium text-ink">{r.name}</td>
                <td className="px-4 py-3 text-ink">{r.rgb.join(", ")}</td>
                <td className="px-4 py-3 text-ink">{toHsl(r.rgb).join(", ")}</td>
                <td className="px-4 py-3 text-ink">{toCmyk(r.rgb).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BrandForm({
  brand,
  onChange,
}: {
  brand: BrandProfile;
  onChange: (partial: Partial<BrandProfile>) => void;
}) {
  const colorFields = [
    { key: "signal", label: "Primary" },
    { key: "accent", label: "Accent" },
    { key: "deep", label: "Dark" },
    { key: "ink", label: "Text" },
    { key: "paper", label: "Background" },
  ] as const;

  return (
    <div className="hairline flex flex-col gap-4 p-4 text-ink">
      <p className="text-sm text-ink">These are suggestions from the website. Change any of them.</p>
      <label className="block">
        <span className={labelCls}>About the brand</span>
        <textarea
          rows={4}
          placeholder="Describe the brand: who it is, what it sells, where it operates."
          value={brand.about ?? ""}
          onChange={(e) => onChange({ about: e.target.value })}
          className={inputCls}
        />
      </label>
      <label className="block">
        <span className={labelCls}>Logo (path or URL)</span>
        <input
          value={brand.logoUrl ?? ""}
          onChange={(e) => onChange({ logoUrl: e.target.value })}
          className={inputCls}
        />
      </label>
      <label className="block">
        <span className={labelCls}>Tagline</span>
        <input
          value={brand.tagline}
          onChange={(e) => onChange({ tagline: e.target.value })}
          className={inputCls}
        />
      </label>
      <div>
        <p className={labelCls}>Colours</p>
        <div className="mt-1 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {colorFields.map((c) => (
            <label key={c.key} className="flex items-center gap-2 text-sm">
              <input
                type="color"
                value={brand.colors[c.key] ?? "#ffffff"}
                onChange={(e) => onChange({ colors: { ...brand.colors, [c.key]: e.target.value } })}
                className="h-9 w-9 shrink-0 cursor-pointer p-0.5"
              />
              {c.label}
            </label>
          ))}
        </div>
      </div>
      <label className="block">
        <span className={labelCls}>Tone of voice</span>
        <p className="mt-1 text-sm text-ink">Suggested from the website and a web search. Edit it if it does not sound like the brand.</p>
        <textarea
          rows={3}
          value={brand.tone}
          onChange={(e) => onChange({ tone: e.target.value })}
          className={inputCls}
        />
      </label>
      <label className="block">
        <span className={labelCls}>Visual style</span>
        <p className="mt-1 text-sm text-ink">Suggested from the website. Edit it if the pictures should look different.</p>
        <textarea
          rows={3}
          value={brand.visualStyle}
          onChange={(e) => onChange({ visualStyle: e.target.value })}
          className={inputCls}
        />
      </label>
    </div>
  );
}

function EditableBrandName({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        autoFocus
        aria-label="Brand name"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") setEditing(false);
        }}
        className="w-full max-w-md border-b border-signal bg-transparent font-serif outline-none"
      />
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      {value || "Your brand"}
      <button
        type="button"
        aria-label="Edit brand name"
        title="Edit brand name"
        onClick={() => setEditing(true)}
        className="rounded p-1 text-mute hover:text-ink"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </button>
    </span>
  );
}

export default function BrandPage() {
  const brand = useAisle((s) => s.brand);
  const updateBrand = useAisle((s) => s.updateBrand);
  const modelId = useAisle((s) => s.settings.agents.trend.modelId);
  const [researching, setResearching] = useState(false);
  const [researchNote, setResearchNote] = useState<string | null>(null);
  const [researchError, setResearchError] = useState<string | null>(null);
  const { paper, signal } = brand.colors;

  async function research() {
    setResearching(true);
    setResearchError(null);
    try {
      const response = await fetch("/api/brand/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: brand.retailerName, website: brand.website, modelId }),
      });
      const json = (await response.json()) as {
        error?: string;
        about?: string;
        tagline?: string;
        logoUrl?: string;
        tone?: string;
        visualStyle?: string;
        colors?: BrandProfile["colors"];
        sourceNote?: string;
      };
      if (!response.ok) throw new Error(json.error || "The site could not be read.");
      updateBrand({
        about: json.about || brand.about,
        tagline: json.tagline || brand.tagline,
        logoUrl: json.logoUrl || brand.logoUrl,
        ...(json.tone?.trim() ? { tone: json.tone } : {}),
        ...(json.visualStyle?.trim() ? { visualStyle: json.visualStyle } : {}),
        colors: { ...brand.colors, ...json.colors },
      });
      setResearchNote(json.sourceNote ?? "Suggestion ready. Edit anything that does not fit.");
    } catch (error) {
      setResearchError(error instanceof Error ? error.message : "The site could not be read.");
    } finally {
      setResearching(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <PageHeader
          eyebrow="Brand"
          title={<EditableBrandName value={brand.retailerName} onChange={(v) => updateBrand({ retailerName: v })} />}
        />
        {brand.about && (
          <p className="mt-2 max-w-4xl text-[15px] leading-relaxed text-ink-soft">{brand.about}</p>
        )}
        <div className="mt-3 max-w-4xl">
          <p className={labelCls}>Website</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              type="url"
              aria-label="Website"
              placeholder="https://www.example.com/"
              value={brand.website ?? ""}
              onChange={(e) => updateBrand({ website: e.target.value })}
              className={`${inputCls} mt-0 min-w-[16rem] flex-1`}
            />
            <button
              type="button"
              disabled={researching || !brand.retailerName.trim() || !brand.website?.trim()}
              onClick={() => void research()}
              className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-paper-2 disabled:opacity-50"
            >
              {researching ? "Reading the site…" : "Research brand"}
            </button>
          </div>
          <p className="mt-2 text-sm text-ink">
            Name and website are all you enter. Research reads the site for the logo, colours and about text, then suggests a tone and a visual style you can edit.
          </p>
          {researchNote ? <p className="mt-2 text-sm text-ink">{researchNote}</p> : null}
          {researchError ? <p className="mt-2 text-sm text-ink">{researchError}</p> : null}
          {brand.website && /^https?:\/\//.test(brand.website) && (
            <a href={brand.website} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-ink underline">
              Visit website
            </a>
          )}
        </div>
      </div>

      <section
        className="flex items-center gap-5 rounded-[16px] p-8 text-ink"
        style={{ background: paper, boxShadow: "inset 0 0 0 1px var(--line)" }}
      >
        {brand.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logoUrl} alt={`${brand.retailerName} logo`} className="h-16 w-auto max-w-[60%] object-contain" />
        ) : (
          <span
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[14px] text-3xl font-semibold"
            style={{ background: signal, color: "#ffffff" }}
          >
            {brand.retailerName.trim().charAt(0).toUpperCase() || "?"}
          </span>
        )}
        {brand.tagline && <p className="text-sm opacity-70">{brand.tagline}</p>}
      </section>

      <ColourScheme colors={brand.colors} />

      <BrandForm brand={brand} onChange={updateBrand} />

      <RetailDataPanel />
    </div>
  );
}
