import { useEffect, type RefObject } from "react";

/** Close a popover on an outside mousedown or the Escape key while it is open. */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  setOpen: (v: boolean) => void,
) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref, setOpen]);
}
