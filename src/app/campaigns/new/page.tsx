"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { IntakeChatbot } from "@/components/intake/IntakeChatbot";
import { parseMoneyInput } from "@/lib/retail/whichgrocer/clearance";
import { validateIntake } from "@/lib/runtime/intake";
import { attachableRecommendation } from "@/lib/runtime/defaults";
import type { CampaignInput, Channel, Country } from "@/lib/types";
import { channelLabel } from "@/lib/status";
import { PageHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useAisle } from "@/lib/store";

const channels: Channel[] = ["instagram", "web", "email", "print", "digital_signage"];
const countries: { id: Country; label: string }[] = [
  { id: "AU", label: "Australia" },
  { id: "NZ", label: "New Zealand" },
  { id: "UK", label: "United Kingdom" },
  { id: "US", label: "United States" },
];
const categories = ["Grocery", "Apparel", "Pantry", "Home", "Beauty"];
const goals = ["Drive sales", "Build awareness", "Promote a new product", "Clear stock"];
/** Fields that live under "More options", so a problem there opens the panel. */
const advancedFields = ["category", "startDate", "endDate", "country"];

const input =
  "w-full border border-line bg-surface px-3 py-2.5 text-[15px] outline-none transition focus:border-signal focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--signal)_18%,transparent)]";

function isoDay(offsetDays: number) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function emptyBrief(): CampaignInput {
  return {
    name: "",
    product: "",
    category: "Grocery",
    targetAudience: "",
    objective: "",
    // Not asked for: the engine still needs a figure, so every brief carries this default.
    budget: 8000,
    channels: ["instagram"],
    startDate: isoDay(7),
    endDate: isoDay(21),
    country: "AU",
    notes: "",
    productImageUrl: null,
  };
}

function compressProductPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("unreadable"));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 1280;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("canvas"));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => reject(new Error("image"));
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {hint ? <span className="ml-2 text-xs text-mute">{hint}</span> : null}
      <div className="mt-1.5">{children}</div>
      {error ? <p className="mt-1 text-xs text-signal">{error}</p> : null}
    </label>
  );
}

export default function NewCampaignPage() {
  const router = useRouter();
  const createCampaign = useAisle((s) => s.createCampaign);
  const launch = useAisle((s) => s.launch);
  const brand = useAisle((s) => s.brand);
  const campaigns = useAisle((s) => s.campaigns);
  const [form, setForm] = useState<CampaignInput>(emptyBrief);
  const [costText, setCostText] = useState("");
  const [priceText, setPriceText] = useState("");
  const [imageError, setImageError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [attempted, setAttempted] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [mode, setMode] = useState<"form" | "chat">("form");
  const priorRecommendation = useMemo(
    () => attachableRecommendation(campaigns),
    [campaigns],
  );

  function update<K extends keyof CampaignInput>(key: K, value: CampaignInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onProductImage(file: File | undefined) {
    setImageError(null);
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setImageError("Choose a JPEG, PNG or WebP photo.");
      return;
    }
    if (file.size > 8_000_000) {
      setImageError("That photo is over 8 MB. Choose a smaller one.");
      return;
    }
    try {
      const url = await compressProductPhoto(file);
      if (url.length > 1_200_000) {
        setImageError("That photo is still too large after compression.");
        return;
      }
      update("productImageUrl", url);
    } catch {
      setImageError("That photo could not be read.");
    }
  }

  function toggleChannel(ch: Channel) {
    setForm((f) => ({
      ...f,
      channels: f.channels.includes(ch)
        ? f.channels.filter((x) => x !== ch)
        : [...f.channels, ch],
    }));
  }

  /** The name is optional: it falls back to the product, so most people never type it. */
  const costParsed = parseMoneyInput(costText);
  const priceParsed = parseMoneyInput(priceText);
  const brief: CampaignInput = {
    ...form,
    name: form.name.trim() || (form.product.trim() ? `${form.product.trim()} campaign` : ""),
    unitCostAud: typeof costParsed === "number" ? costParsed : null,
    currentPriceAud: typeof priceParsed === "number" ? priceParsed : null,
  };

  /** The same checks the engine runs at launch, so a launch is never a surprise. */
  const problems = [
    ...(costParsed === "invalid"
      ? [{ field: "unitCostAud", message: "Enter the cost in dollars, such as 1.80.", clause: "Clearance price" }]
      : []),
    ...(priceParsed === "invalid"
      ? [{ field: "currentPriceAud", message: "Enter the selling price in dollars, such as 3.50.", clause: "Clearance price" }]
      : []),
    ...validateIntake(brief, brand).filter(
      (problem) =>
        !(problem.field === "unitCostAud" && costParsed === "invalid") &&
        !(problem.field === "currentPriceAud" && priceParsed === "invalid"),
    ),
  ];
  const errorFor = (...fields: string[]) =>
    attempted ? problems.find((p) => fields.includes(p.field))?.message : undefined;
  const hiddenProblems = problems.filter((p) => advancedFields.includes(p.field));
  const moreVisible = moreOpen || (attempted && hiddenProblems.length > 0);

  async function submit(run: boolean) {
    setAttempted(true);
    if (problems.length > 0) {
      requestAnimationFrame(() =>
        document
          .querySelector("[data-invalid]")
          ?.scrollIntoView({ block: "center", behavior: "smooth" }),
      );
      return;
    }
    const id = createCampaign(brief);
    router.push(`/campaigns/${id}`);
    if (run) await launch(id);
  }

  return (
    <div className={mode === "chat" ? "flex max-w-5xl flex-col gap-8 pb-28" : "flex max-w-2xl flex-col gap-8 pb-28"}>
      <PageHeader
        title="New campaign"
        description="Describe what you're promoting and who it's for. Your AI agents research the market, design the creative and run compliance checks, then send the finished campaign to you for approval. Nothing is published until you say so."
      />

      <div
        role="tablist"
        aria-label="Campaign intake mode"
        className="inline-flex w-fit border border-line bg-surface p-1 text-sm"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "form"}
          onClick={() => setMode("form")}
          className={cn(
            "px-3.5 py-1.5 transition",
            mode === "form" ? "bg-signal font-medium text-white" : "text-ink-soft hover:text-ink",
          )}
        >
          Write in form
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "chat"}
          onClick={() => setMode("chat")}
          className={cn(
            "px-3.5 py-1.5 transition",
            mode === "chat" ? "bg-signal font-medium text-white" : "text-ink-soft hover:text-ink",
          )}
        >
          Describe with AI assistant
        </button>
      </div>

      <div
        className="hairline p-4"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void onProductImage(e.dataTransfer.files?.[0]);
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-[16rem] flex-1">
            <p className="text-sm font-medium">Product photo</p>
            <p className="mt-1 text-xs leading-relaxed text-mute">
              Optional. The image step builds the ad around this picture instead of inventing the product. A basketball shoe is worn by an athlete dunking; the shoe in the photo stays the shoe.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {form.productImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.productImageUrl} alt="Uploaded product" className="h-20 w-20 border border-line object-cover" />
            ) : null}
            <div className="flex flex-col items-start gap-1.5">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  void onProductImage(e.target.files?.[0]);
                  e.target.value = "";
                }}
                className="sr-only"
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-signal hover:text-signal-dark"
              >
                {form.productImageUrl ? "Replace photo" : "Upload photo"}
              </button>
              {form.productImageUrl ? (
                <button type="button" onClick={() => update("productImageUrl", null)} className="text-xs text-mute hover:text-ink">
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        </div>
        {imageError ? <p className="mt-2 text-xs text-signal">{imageError}</p> : null}
      </div>

      {mode === "chat" ? (
        <IntakeChatbot
          brand={brand}
          form={form}
          priorRecommendation={priorRecommendation}
          onApplyDraft={(next) => setForm(next)}
          onSwitchToForm={() => setMode("form")}
        />
      ) : (
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(true);
        }}
      >
        <section className="hairline flex flex-col gap-6 p-4">
          <Field label="What are you promoting?" error={errorFor("product", "name")}>
            <input
              autoFocus
              value={form.product}
              onChange={(e) => update("product", e.target.value)}
              placeholder="Fresh oranges and juice"
              data-invalid={errorFor("product", "name") ? "" : undefined}
              className={input}
            />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="What it costs you" hint="AUD per unit" error={errorFor("unitCostAud")}>
              <input
                inputMode="decimal"
                value={costText}
                onChange={(e) => {
                  setCostText(e.target.value);
                  const parsed = parseMoneyInput(e.target.value);
                  update("unitCostAud", typeof parsed === "number" ? parsed : null);
                }}
                placeholder="1.80"
                data-invalid={errorFor("unitCostAud") ? "" : undefined}
                className={input}
              />
            </Field>
            <Field label="What you sell it for now" hint="AUD per unit" error={errorFor("currentPriceAud")}>
              <input
                inputMode="decimal"
                value={priceText}
                onChange={(e) => {
                  setPriceText(e.target.value);
                  const parsed = parseMoneyInput(e.target.value);
                  update("currentPriceAud", typeof parsed === "number" ? parsed : null);
                }}
                placeholder="3.50"
                data-invalid={errorFor("currentPriceAud") ? "" : undefined}
                className={input}
              />
            </Field>
          </div>
          <p className="-mt-3 text-xs text-mute">
            For a clear-stock campaign, the trend step compares these with live Coles, Woolworths and ALDI prices and recommends a discount. The discount will not go below your cost.
          </p>
          <Field label="Who is it for?" error={errorFor("targetAudience")}>
            <input
              value={form.targetAudience}
              onChange={(e) => update("targetAudience", e.target.value)}
              placeholder="Families doing the weekly shop"
              data-invalid={errorFor("targetAudience") ? "" : undefined}
              className={input}
            />
          </Field>
          <Field label="What should it achieve?" error={errorFor("objective")}>
            <input
              value={form.objective}
              onChange={(e) => update("objective", e.target.value)}
              placeholder="Sell more over the next two weeks"
              data-invalid={errorFor("objective") ? "" : undefined}
              className={input}
            />
            <p className="mt-3 text-xs text-mute">Or pick one:</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {goals.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => update("objective", g)}
                  className="border border-line bg-surface px-3 py-1.5 text-sm text-ink hover:border-signal hover:text-signal-dark"
                >
                  {g}
                </button>
              ))}
            </div>
          </Field>
          <fieldset>
            <legend className="text-sm font-medium">Where should it run?</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {channels.map((ch) => {
                const on = form.channels.includes(ch);
                return (
                  <button
                    key={ch}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleChannel(ch)}
                    className={cn(
                      "inline-flex items-center gap-1.5 border px-3 py-1.5 text-sm transition",
                      on
                        ? "border-signal bg-signal/10 font-medium text-signal-dark"
                        : "border-line bg-surface text-ink-soft hover:border-mute",
                    )}
                  >
                    {on ? <Check size={14} strokeWidth={2.5} /> : null}
                    {channelLabel[ch]}
                  </button>
                );
              })}
            </div>
            {errorFor("channels") ? (
              <p data-invalid className="mt-1.5 text-xs text-signal">
                {errorFor("channels")}
              </p>
            ) : null}
          </fieldset>
        </section>

        <section className="hairline">
          <button
            type="button"
            aria-expanded={moreVisible}
            onClick={() => setMoreOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-3 p-4 text-left"
          >
            <span>
              <span className="block text-sm font-medium">More options</span>
              <span className="block text-xs text-mute">
                {form.startDate} to {form.endDate} ·{" "}
                {countries.find((c) => c.id === form.country)?.label} · {form.category}
              </span>
            </span>
            <ChevronDown
              size={16}
              className={cn("shrink-0 text-mute transition", moreVisible && "rotate-180")}
            />
          </button>
          {moreVisible ? (
            <div className="flex flex-col gap-5 border-t border-line p-4">
              <Field label="Campaign name" hint="Optional">
                <input
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  placeholder={brief.name || "Leave blank to use the product name"}
                  className={input}
                />
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Category" error={errorFor("category")}>
                  <select
                    value={form.category}
                    onChange={(e) => update("category", e.target.value)}
                    className={input}
                  >
                    {categories.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Market" hint="Chooses that country's law index" error={errorFor("country")}>
                  <select
                    value={form.country}
                    onChange={(e) => update("country", e.target.value as Country)}
                    className={input}
                  >
                    {countries.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Starts" error={errorFor("startDate")}>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => update("startDate", e.target.value)}
                    data-invalid={errorFor("startDate") ? "" : undefined}
                    className={input}
                  />
                </Field>
                <Field label="Ends" error={errorFor("endDate")}>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(e) => update("endDate", e.target.value)}
                    data-invalid={errorFor("endDate") ? "" : undefined}
                    className={input}
                  />
                </Field>
              </div>
              <Field label="Notes for the agents" hint="Optional">
                <textarea
                  value={form.notes}
                  onChange={(e) => update("notes", e.target.value)}
                  rows={3}
                  placeholder="Anything the agents should know, like tone or things to avoid"
                  className={input}
                />
              </Field>
            </div>
          ) : null}
        </section>

        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/90 px-4 py-3 backdrop-blur lg:left-60">
          <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-mute">
              {attempted && problems.length > 0
                ? `${problems.length} thing${problems.length === 1 ? "" : "s"} to fix above.`
                : "You'll review everything before it goes live."}
            </p>
            <div className="flex items-center gap-2">
              <Link href="/campaigns" className="px-3 py-2 text-sm text-ink-soft hover:text-ink">
                Cancel
              </Link>
              <button
                type="button"
                onClick={() => void submit(false)}
                className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-paper-2"
              >
                Save draft
              </button>
              <button
                type="submit"
                className="rounded-full bg-signal px-5 py-2 text-sm font-semibold text-white hover:bg-signal-dark"
              >
                Launch agents
              </button>
            </div>
          </div>
        </div>
      </form>
      )}
    </div>
  );
}
