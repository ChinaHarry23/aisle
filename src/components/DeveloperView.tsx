"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/cn";

const STORAGE_KEY = "aisle-developer-view";
const CHANGE_EVENT = "aisle-developer-view-change";

type DeveloperViewValue = {
  /** Model ids, traces, tool calls and other debugging detail. */
  developer: boolean;
  setDeveloper: (value: boolean) => void;
};

const DeveloperViewContext = createContext<DeveloperViewValue>({
  developer: false,
  setDeveloper: () => {},
});

function subscribe(onStoreChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
}

function readDeveloper() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function DeveloperViewProvider({ children }: { children: ReactNode }) {
  const developer = useSyncExternalStore(subscribe, readDeveloper, () => false);

  const setDeveloper = (value: boolean) => {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };

  return (
    <DeveloperViewContext.Provider value={{ developer, setDeveloper }}>
      {children}
    </DeveloperViewContext.Provider>
  );
}

export function useDeveloperView() {
  return useContext(DeveloperViewContext);
}

/** One control for the two interface versions. The choice stays in this browser. */
export function DeveloperViewToggle() {
  const { developer, setDeveloper } = useDeveloperView();
  return (
    <button
      type="button"
      aria-pressed={developer}
      title={developer ? "Switch to the simpler user view" : "Show debugging details"}
      onClick={() => setDeveloper(!developer)}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium",
        developer ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink hover:bg-paper-2",
      )}
    >
      {developer ? "Developer view" : "User view"}
    </button>
  );
}
