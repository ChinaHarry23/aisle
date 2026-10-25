"use client";

import { useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { bundledRetail, type BundledRetailId } from "@/lib/retail/bundled";
import { formatDate } from "@/lib/ids";
import { parseRetailUpload, retailerKey } from "@/lib/retail-data";
import { useAisle } from "@/lib/store";

const DEMO_FILES: { id: BundledRetailId; name: string; fileName: string }[] = [
  { id: "coles", name: "Coles", fileName: "coles.json" },
  { id: "woolworths", name: "Woolworths", fileName: "woolworths.json" },
];

/** Load a local demo extract, or a file in the same shape, onto this brand. */
export function RetailDataPanel() {
  const brand = useAisle((s) => s.brand);
  const updateBrand = useAisle((s) => s.updateBrand);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const data = brand.retailData?.schemaVersion === "1.0" ? brand.retailData : null;
  const stale = Boolean(brand.retailData) && !data;
  const mismatch = data && retailerKey(data.retailer.name) !== retailerKey(brand.retailerName);

  function take(fileName: string, value: unknown) {
    const parsed = parseRetailUpload(value, fileName);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    updateBrand({ retailData: parsed.dataset });
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("Keep the retail data file under 2 MB.");
      return;
    }
    setLoading(file.name);
    try {
      take(file.name, JSON.parse(await file.text()) as unknown);
    } catch {
      setError("That file is not valid JSON.");
    } finally {
      setLoading(null);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <section aria-label="Retail data" className="hairline p-4 text-ink">
      <div className="text-center">
        <h2 className="font-serif text-xl text-ink">Retail data</h2>
        <p className="mt-1 text-base text-ink">
          POS, catalogue history and competitor checks for this retailer. The files live in the project. Upload one, or load a local demo. A file for another banner is not used.
        </p>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          disabled={loading != null}
          onClick={() => input.current?.click()}
          className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-paper-2 disabled:opacity-50"
        >
          <Upload size={14} /> {loading ? "Reading…" : "Upload JSON"}
        </button>
        {DEMO_FILES.map((file) => (
          <button
            key={file.id}
            type="button"
            disabled={loading != null}
            onClick={() => take(file.fileName, bundledRetail[file.id])}
            className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-paper-2 disabled:opacity-50"
          >
            Use {file.name} file
          </button>
        ))}
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => void upload(e.target.files?.[0])}
        />
      </div>
      <p className="mt-3 text-center text-sm text-ink">
        Local files:{" "}
        {DEMO_FILES.map((file, index) => (
          <span key={file.id}>
            {index > 0 ? " · " : ""}
            <a href={`/api/retail-data/${file.id}`} className="font-medium text-ink underline">
              {file.name}
            </a>
          </span>
        ))}
      </p>
      {error ? (
        <p role="alert" className="mt-3 text-center text-sm text-ink">
          {error}
        </p>
      ) : null}
      {stale ? (
        <p className="mt-3 text-center text-sm text-ink">The saved extract is an older POS-only file. Load the Coles or Woolworths file again.</p>
      ) : null}
      {data ? (
        <div className="mt-4 flex items-start justify-between gap-3 border-t border-line pt-3 text-ink">
          <div className="min-w-0">
            <p className="font-medium text-ink">{data.retailer.name} retail data</p>
            <p className="mt-0.5 text-sm text-ink">
              {data.fileName} · extracted {data.extractedAt} · {data.products.length} products · POS, catalogue and competitors · loaded {formatDate(data.uploadedAt, true)}
            </p>
            <p className="mt-1 text-sm text-ink">{data.note}</p>
            {mismatch ? (
              <p className="mt-2 text-sm text-ink">
                This file is {data.retailer.name}. The brand name is {brand.retailerName || "blank"}, so the trend step will not use it until they match.
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Remove retail data"
            onClick={() => updateBrand({ retailData: null })}
            className="rounded-lg p-2 text-ink hover:bg-paper-2"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ) : stale ? null : (
        <p className="mt-3 text-center text-sm text-ink">Nothing loaded yet. The trend step will not invent retail figures.</p>
      )}
    </section>
  );
}
