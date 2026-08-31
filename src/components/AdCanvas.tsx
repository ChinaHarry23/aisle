import { cn } from "@/lib/cn";
import type { Creative } from "@/lib/types";

function Motif({ motif, accent }: { motif: Creative["motif"]; accent: string }) {
  if (motif === "campus") {
    return (
      <svg viewBox="0 0 120 140" className="h-full w-full" aria-hidden>
        <path
          d="M30 118 L30 58 L60 38 L90 58 L90 118"
          fill="none"
          stroke={accent}
          strokeWidth="3"
        />
        <path d="M22 70 L60 46 L98 70" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.5" />
        <rect x="52" y="78" width="16" height="40" fill="currentColor" opacity="0.2" />
      </svg>
    );
  }
  if (motif === "produce") {
    return (
      <svg viewBox="0 0 120 140" className="h-full w-full" aria-hidden>
        <ellipse cx="58" cy="78" rx="28" ry="34" fill={accent} opacity="0.85" />
        <ellipse cx="78" cy="86" rx="20" ry="26" fill="currentColor" opacity="0.18" />
        <path d="M58 44 C62 36, 74 34, 78 42" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  }
  if (motif === "pantry") {
    return (
      <svg viewBox="0 0 120 140" className="h-full w-full" aria-hidden>
        <rect x="38" y="40" width="44" height="70" rx="6" fill="none" stroke="currentColor" strokeWidth="2" />
        <rect x="44" y="52" width="32" height="18" fill={accent} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 120 140" className="h-full w-full" aria-hidden>
      <line x1="24" y1="40" x2="96" y2="40" stroke="currentColor" strokeWidth="2" />
      <line x1="24" y1="56" x2="72" y2="56" stroke={accent} strokeWidth="6" />
      <line x1="24" y1="80" x2="88" y2="80" stroke="currentColor" strokeWidth="2" opacity="0.4" />
      <line x1="24" y1="96" x2="64" y2="96" stroke="currentColor" strokeWidth="2" opacity="0.4" />
    </svg>
  );
}

export function AdCanvas({
  creative,
  className,
  compact,
}: {
  creative: Creative;
  className?: string;
  compact?: boolean;
}) {
  return (
    <article
      className={cn("relative overflow-hidden", className)}
      style={{ background: creative.palette.bg, color: creative.palette.fg }}
    >
      {creative.generation?.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={creative.generation.url}
          alt={creative.headline}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
      <div className="pointer-events-none absolute -right-6 -top-8 h-44 w-36 opacity-80">
        <Motif motif={creative.motif} accent={creative.palette.accent} />
      </div>
      <div className={cn("relative flex h-full flex-col justify-between", compact ? "p-5" : "p-7")}>
        <div>
          <p
            className="text-[10px] uppercase tracking-[0.22em]"
            style={{ color: creative.palette.accent }}
          >
            {creative.kicker}
          </p>
          <h3
            className={cn(
              "mt-3 font-serif leading-[1.05] tracking-tight",
              compact ? "text-2xl" : "text-3xl md:text-4xl",
            )}
          >
            {creative.headline}
          </h3>
          <p
            className={cn("mt-3 max-w-[34ch] leading-relaxed", compact ? "text-xs" : "text-sm")}
            style={{ color: creative.palette.muted }}
          >
            {creative.subhead}
          </p>
        </div>
        <div className="mt-8 flex items-center justify-between gap-3">
          <span
            className="inline-flex items-center rounded-full px-3 py-1 text-[11px] tracking-wide"
            style={{ background: creative.palette.accent, color: creative.palette.bg }}
          >
            {creative.cta}
          </span>
          <span className="text-[10px] uppercase tracking-[0.18em] opacity-70">
            Lane & Co. · {creative.variant}
            {creative.version > 1 ? ` · v${creative.version}` : ""}
          </span>
        </div>
      </div>
    </article>
  );
}
