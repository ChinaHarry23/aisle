"use client";

import { useRef, useState } from "react";
import { FileText, Trash2, Upload } from "lucide-react";
import {
  GUIDELINE_ACCEPT,
  MAX_GUIDELINE_BYTES,
  MAX_GUIDELINE_FILES,
  toGuidelineDoc,
} from "@/lib/guidelines";
import { useAisle } from "@/lib/store";

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export const GUIDELINES_INTRO =
  "Upload your style guide, legal checklist or claims policy. The Creative agent writes to it and the Compliance Checker flags anything that breaks it.";

/** Upload brand guidelines that the Creative and Compliance agents read. */
export function GuidelinesPanel({
  className,
  hideHeader,
}: {
  className?: string;
  hideHeader?: boolean;
}) {
  const guidelines = useAisle((s) => s.brand.guidelines) ?? [];
  const updateBrand = useAisle((s) => s.updateBrand);
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setUploading(true);
    const added = [];
    const problems: string[] = [];
    for (const file of Array.from(files)) {
      if (guidelines.length + added.length >= MAX_GUIDELINE_FILES) {
        problems.push(`Limit is ${MAX_GUIDELINE_FILES} documents.`);
        break;
      }
      if (file.size > MAX_GUIDELINE_BYTES) {
        problems.push(`${file.name} is over 5 MB.`);
        continue;
      }
      const body = new FormData();
      body.append("file", file);
      try {
        const res = await fetch("/api/guidelines/extract", { method: "POST", body });
        const json = (await res.json()) as { text?: string; error?: string };
        if (!res.ok || !json.text) problems.push(`${file.name}: ${json.error ?? "upload failed."}`);
        else added.push(toGuidelineDoc(file.name, file.size, json.text));
      } catch {
        problems.push(`${file.name}: couldn't reach the server.`);
      }
    }
    if (added.length) updateBrand({ guidelines: [...guidelines, ...added] });
    if (problems.length) setError(problems.join(" "));
    setUploading(false);
    if (input.current) input.current.value = "";
  }

  return (
    <section aria-label="Brand guidelines" className={className}>
      <div className="hairline p-4">
        {hideHeader ? null : (
          <div className="min-w-0 text-center">
            <h2 className="font-serif text-xl">Brand guidelines</h2>
            <p className="mt-1 text-base text-ink-soft">{GUIDELINES_INTRO}</p>
          </div>
        )}
        <div className={`${hideHeader ? "" : "mt-4 "}flex justify-center`}>
          <button
            type="button"
            disabled={uploading}
            onClick={() => input.current?.click()}
            className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-medium hover:bg-paper-2 disabled:opacity-50"
          >
            <Upload size={14} /> {uploading ? "Reading…" : "Upload"}
          </button>
          <input
            ref={input}
            type="file"
            multiple
            accept={GUIDELINE_ACCEPT}
            className="hidden"
            onChange={(e) => void upload(e.target.files)}
          />
        </div>

        {error ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        ) : null}

        {guidelines.length > 0 ? (
          <ul className="mt-3 flex flex-col">
            {guidelines.map((g) => (
              <li
                key={g.id}
                className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0"
              >
                <FileText size={16} className="shrink-0 text-signal" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium">{g.name}</p>
                  <p className="text-sm text-mute">
                    {kb(g.size)} · {g.text.length.toLocaleString()} characters read
                    {g.truncated ? " (long document, cut)" : ""}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${g.name}`}
                  onClick={() =>
                    updateBrand({ guidelines: guidelines.filter((x) => x.id !== g.id) })
                  }
                  className="rounded-lg p-2 text-mute hover:bg-paper-2 hover:text-danger"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-center text-base text-mute">
            Nothing uploaded yet. PDF, Word, or text files up to 5 MB.
          </p>
        )}
      </div>
    </section>
  );
}
