"use client";

import { cn } from "@/lib/cn";
import { modelsOf } from "@/lib/media/catalog";
import { requestGenerate } from "@/lib/media/client";
import type { AspectRatio, MediaGeneration } from "@/lib/media/types";
import { useAisle } from "@/lib/store";
import { useEffect, useRef, useState } from "react";

type Quality = "low" | "medium" | "high";

type Step = {
  id: number;
  tab: "input" | "output";
  images: string[];
  prompt: string;
  outputs: MediaGeneration[];
  pick: number;
  busy: boolean;
};

const COUNTS = [1, 2, 3, 4];
const ASPECTS: AspectRatio[] = ["4:5", "1:1", "3:4", "9:16", "16:9"];
const QUALITIES: Quality[] = ["low", "medium", "high"];

type Template = { group: string; label: string; prompt: (brand: string) => string };

const KEEP_LOGO = "Do not edit the logo.";

const TEMPLATES: Template[] = [
  {
    group: "Product",
    label: "Hero shot on white",
    prompt: (b) =>
      `A clean product hero shot on a pure white background, soft natural shadow, centred, sharp detail. Subtle ${b} branding on the pack. Leave room for a price badge. ${KEEP_LOGO}`,
  },
  {
    group: "Product",
    label: "Fresh produce display",
    prompt: (b) =>
      `A wooden crate of fresh fruit and vegetables in warm morning light, water droplets on the produce, a ${b} paper bag beside it. Natural, appetising, honest. Headline space at the top. ${KEEP_LOGO}`,
  },
  {
    group: "Product",
    label: "Pantry shelf",
    prompt: (b) =>
      `A tidy pantry shelf stocked with ${b} products, labels facing forward, soft side lighting, shallow depth of field. ${KEEP_LOGO}`,
  },
  {
    group: "Lifestyle",
    label: "Summer picnic",
    prompt: (b) =>
      `A sunny park picnic with a family on a yellow checkered blanket, slightly blurred in the background. A reusable ${b} tote bag is open in the foreground with bananas next to it. Green trees, blue sky, a bicycle leaning against a tree. Cheerful, summery. Subtle ${b} branding on the tote bag. ${KEEP_LOGO} Use only ${b} branding, no other retailer.`,
  },
  {
    group: "Lifestyle",
    label: "Family dinner",
    prompt: (b) =>
      `A warm kitchen table with a home-cooked family dinner, a ${b} shopping bag on the counter behind. Soft evening light, relaxed and inviting, people softly out of focus. Short headline at the bottom. ${KEEP_LOGO}`,
  },
  {
    group: "Lifestyle",
    label: "Student budget meal",
    prompt: (b) =>
      `A student flat kitchen with a simple, colourful budget meal being cooked, a ${b} bag of groceries on the side. Bright, friendly, real-life. ${KEEP_LOGO}`,
  },
  {
    group: "Marketing",
    label: "Weekly special",
    prompt: (b) =>
      `A bright ${b} promotional ad for this week's special. One hero product on a simple colourful background, bold price callout in the corner, large readable headline at the top, ${b} logo bottom-right. ${KEEP_LOGO}`,
  },
  {
    group: "Marketing",
    label: "Price comparison",
    prompt: (b) =>
      `A split-layout ad comparing a trolley of everyday groceries, with a clear "you save" callout. Clean, trustworthy, not gimmicky. ${b} logo bottom-right. ${KEEP_LOGO}`,
  },
  {
    group: "Marketing",
    label: "Store opening",
    prompt: (b) =>
      `A celebratory "now open" ad for a new ${b} store: bright storefront, balloons, a welcoming crowd, bold headline. ${KEEP_LOGO}`,
  },
  {
    group: "Edit",
    label: "Fix text on last image",
    prompt: () =>
      `Keep the image exactly as it is, but fix the text: use clean sans-serif lettering, correct spelling, and make it fully readable. Do not change anything else.`,
  },
];

const TEMPLATE_GROUPS = ["Product", "Lifestyle", "Marketing", "Edit"];

const newStep = (id: number, images: string[] = []): Step => ({
  id,
  tab: "input",
  images,
  prompt: "",
  outputs: [],
  pick: 0,
  busy: false,
});

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function AdWorkbench({
  defaultPrompt,
  referenceImages = [],
}: {
  defaultPrompt: string;
  /** Product photo from the campaign. Generation builds the scene around it. */
  referenceImages?: string[];
}) {
  const settings = useAisle((s) => s.settings);
  const logo = useAisle((s) => s.brand.logoUrl) || null;
  const brandName = useAisle((s) => s.brand.retailerName) || "the brand";
  const updateSettings = useAisle((s) => s.updateSettings);
  const models = modelsOf("image");
  const modelId = models.some((m) => m.id === settings.imageModelId)
    ? settings.imageModelId
    : models[0].id;

  const [steps, setSteps] = useState<Step[]>([{ ...newStep(1, referenceImages), prompt: defaultPrompt }]);
  const [aspect, setAspect] = useState<AspectRatio>("4:5");
  const [quality, setQuality] = useState<Quality>("high");
  const [count, setCount] = useState(1);

  const patch = (id: number, p: Partial<Step>) =>
    setSteps((all) => all.map((s) => (s.id === id ? { ...s, ...p } : s)));

  async function generate(step: Step) {
    patch(step.id, { busy: true });
    try {
      const contextImages = logo ? [logo, ...step.images.filter((i) => i !== logo)] : step.images;
      const outputs = await Promise.all(
        Array.from({ length: count }, () =>
          requestGenerate({
            kind: "image",
            modelId,
            prompt: step.prompt,
            aspectRatio: aspect,
            quality,
            inputFidelity: "high",
            contextImages,
          }),
        ),
      );
      patch(step.id, { outputs, pick: 0, busy: false, tab: "output" });
      // Chain: make sure there is a next card seeded with the first result.
      setSteps((all) => {
        if (all.some((s) => s.id === step.id + 1)) return all;
        return [...all, newStep(step.id + 1, outputs[0]?.url ? [outputs[0].url] : [])];
      });
    } catch {
      patch(step.id, { busy: false });
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-24">
      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
        {steps.map((step, i) => (
          <StepCard
            key={step.id}
            step={step}
            logo={logo}
            brandName={brandName}
            showArrow={i < steps.length - 1}
            onPatch={(p) => patch(step.id, p)}
            onGenerate={() => void generate(step)}
            onRemove={
              steps.length > 1
                ? () => setSteps((all) => all.filter((s) => s.id !== step.id))
                : undefined
            }
          />
        ))}
      </div>

      <div className="fixed inset-x-0 bottom-5 z-20 flex justify-center px-4">
        <div className="flex max-w-full items-center gap-1.5 rounded-full border border-line bg-[var(--bar-bg)] p-1.5 shadow-[var(--shadow-lift)] backdrop-blur-md">
          <DockMenu
            label="Model"
            value={modelId}
            onChange={(v) => updateSettings({ imageModelId: v })}
            options={models.map((m) => ({ value: m.id, label: m.name }))}
          />
          <DockMenu
            label="Size"
            value={aspect}
            onChange={setAspect}
            options={ASPECTS.map((a) => ({ value: a, label: a, icon: <AspectGlyph ratio={a} /> }))}
          />
          <DockMenu
            label="Quality"
            value={quality}
            onChange={setQuality}
            options={QUALITIES.map((q) => ({ value: q, label: q[0].toUpperCase() + q.slice(1) }))}
          />
          <DockMenu
            label="Variations"
            value={count}
            onChange={setCount}
            options={COUNTS.map((n) => ({ value: n, label: String(n) }))}
          />
        </div>
      </div>
    </div>
  );
}

type MenuOption<T> = { value: T; label: string; icon?: React.ReactNode };

function DockMenu<T extends string | number>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: MenuOption<T>[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-10 items-center gap-2 rounded-full px-4 text-sm transition",
          open ? "bg-signal-soft text-signal-dark" : "hover:bg-line/60",
        )}
      >
        <span className="text-mute">{label}</span>
        <span className="flex items-center gap-1.5 font-medium">
          {current.icon}
          {current.label}
        </span>
        <span aria-hidden className="text-[10px] text-mute">▾</span>
      </button>
      {open ? (
        <ul
          role="listbox"
          className="absolute bottom-full left-1/2 mb-3 min-w-full -translate-x-1/2 rounded-3xl border border-line bg-surface p-1.5 shadow-[var(--shadow-lift)]"
        >
          {options.map((o) => (
            <li key={String(o.value)}>
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-left text-sm transition",
                  o.value === value
                    ? "bg-signal-soft font-medium text-signal-dark"
                    : "hover:bg-line/60",
                )}
              >
                {o.icon}
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function AspectGlyph({ ratio }: { ratio: AspectRatio }) {
  const [w, h] = ratio.split(":").map(Number);
  const scale = 14 / Math.max(w, h);
  return (
    <span
      aria-hidden
      className="inline-block rounded-[3px] border-[1.5px] border-current"
      style={{ width: w * scale, height: h * scale }}
    />
  );
}

function StepCard({
  step,
  logo,
  brandName,
  showArrow,
  onPatch,
  onGenerate,
  onRemove,
}: {
  step: Step;
  logo: string | null;
  brandName: string;
  showArrow: boolean;
  onPatch: (p: Partial<Step>) => void;
  onGenerate: () => void;
  onRemove?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [showCompare, setShowCompare] = useState(false);

  async function addFiles(files: FileList | null) {
    if (!files) return;
    const urls = await Promise.all(Array.from(files).map(readFile));
    onPatch({ images: [...step.images, ...urls] });
  }

  return (
    <div className="flex items-center gap-4">
      <section className="w-[340px] shrink-0 rounded-[var(--r-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{step.id}</h3>
          {onRemove ? (
            <button type="button" onClick={onRemove} className="text-xs text-mute hover:text-danger">
              Remove
            </button>
          ) : null}
        </div>

        <div className="mt-2 flex justify-center gap-6 border-b border-line text-sm">
          {(["input", "output"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onPatch({ tab: t })}
              className={cn(
                "-mb-px border-b-2 px-1 pb-2 capitalize",
                step.tab === t ? "border-ink font-medium" : "border-transparent text-mute",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {step.tab === "input" ? (
          <div className="mt-4 flex flex-col gap-4">
            <div>
              <p className="text-xs font-semibold">Context image(s)</p>
              <div className="mt-2 flex min-h-[92px] flex-wrap items-start gap-3 rounded-xl border border-line p-3">
                {logo ? (
                  <div className="relative" title="Brand logo, always included">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={logo} alt="Brand logo" className="h-16 w-16 rounded-md border border-signal bg-white object-contain p-1" />
                  </div>
                ) : null}
                {step.images.map((src, i) => (
                  <div key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" className="h-16 w-16 rounded-md border border-line object-cover" />
                    <button
                      type="button"
                      aria-label="Remove image"
                      onClick={() => onPatch({ images: step.images.filter((_, j) => j !== i) })}
                      className="absolute -bottom-2 -left-2 grid h-5 w-5 place-items-center rounded-full bg-mute text-[11px] leading-none text-paper"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  aria-label="Add context image"
                  onClick={() => fileRef.current?.click()}
                  className="grid h-9 w-9 place-items-center rounded-full bg-signal-soft text-signal"
                >
                  +
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    void addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>

            <select
              value=""
              onChange={(e) => {
                const t = TEMPLATES[Number(e.target.value)];
                if (t) onPatch({ prompt: t.prompt(brandName) });
              }}
              className="w-full rounded-[var(--r-btn)] border border-line bg-surface px-3 py-2 text-sm text-mute outline-none"
            >
              <option value="">Start from an example…</option>
              {TEMPLATE_GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {TEMPLATES.map((t, i) =>
                    t.group === g ? (
                      <option key={t.label} value={i}>
                        {t.label}
                      </option>
                    ) : null,
                  )}
                </optgroup>
              ))}
            </select>

            <div>
              <p className="text-xs font-semibold">Context prompt</p>
              <textarea
                value={step.prompt}
                onChange={(e) => onPatch({ prompt: e.target.value })}
                rows={8}
                placeholder={
                  step.id > 1 ? "Describe what to change, e.g. “fix text, use sans-serif”" : "Describe the ad"
                }
                className="mt-2 w-full resize-y rounded-xl border border-line bg-surface p-3 text-sm outline-none focus:border-signal"
              />
            </div>

            <button
              type="button"
              disabled={step.busy || !step.prompt.trim()}
              onClick={onGenerate}
              className="w-full rounded-[var(--r-btn)] btn-primary py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {step.busy ? "Generating…" : "Generate"}
            </button>
          </div>
        ) : (
          <div className="mt-4">
            {step.outputs[step.pick]?.url ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={step.outputs[step.pick].url!} alt="" className="w-full rounded-xl border border-line" />
                {step.outputs.length > 1 ? (
                  <div className="mt-3 flex gap-2">
                    {step.outputs.map((o, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => onPatch({ pick: i })}
                        className={cn(
                          "overflow-hidden rounded-md border-2",
                          i === step.pick ? "border-signal" : "border-transparent opacity-70",
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={o.url ?? ""} alt={`Variation ${i + 1}`} className="h-14 w-14 object-cover" />
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="mt-3 flex items-center justify-between text-xs text-mute">
                  <span>{step.outputs[step.pick].modelName}</span>
                  {step.images[0] ? (
                    <label className="flex items-center gap-2">
                      Compare
                      <input
                        type="checkbox"
                        checked={showCompare}
                        onChange={(e) => setShowCompare(e.target.checked)}
                      />
                    </label>
                  ) : null}
                </div>
                {showCompare && step.images[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={step.images[0]} alt="Context" className="mt-3 w-full rounded-xl border border-line" />
                ) : null}
              </>
            ) : (
              <p className="py-12 text-center text-sm text-mute">
                {step.outputs[0] ? step.outputs[0].note : "Nothing generated yet."}
              </p>
            )}
          </div>
        )}
      </section>

      {showArrow ? <span aria-hidden className="text-xl text-ink-soft">→</span> : null}
    </div>
  );
}
