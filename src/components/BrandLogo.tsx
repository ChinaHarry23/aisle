import { ShoppingCart } from "lucide-react";
import { cn } from "@/lib/cn";

// Default mark: a shopping cart in a rounded tile, with the wordmark beside it.
export function BrandLogo({ size = "md" }: { size?: "md" | "lg" }) {
  const lg = size === "lg";
  return (
    <span className="inline-flex items-center gap-2.5" aria-label="Aisle">
      <span
        aria-hidden
        className={cn(
          "flex items-center justify-center rounded-[10px] bg-signal text-white",
          lg ? "h-11 w-11" : "h-9 w-9",
        )}
      >
        <ShoppingCart size={lg ? 24 : 20} strokeWidth={2} />
      </span>
      <span
        className={cn(
          "font-semibold leading-none tracking-tight text-ink",
          lg ? "text-3xl" : "text-[1.4rem]",
        )}
      >
        <span className="text-signal">Ai</span>sle
      </span>
    </span>
  );
}
