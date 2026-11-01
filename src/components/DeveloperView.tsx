"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

const STORAGE_KEY = "aisle-developer-view";

type DeveloperViewValue = {
  /** Model ids, traces, tool calls and other debugging detail. */
  developer: boolean;
  setDeveloper: (value: boolean) => void;
};

const DeveloperViewContext = createContext<DeveloperViewValue>({
  developer: false,
  setDeveloper: () => {},
});

export function DeveloperViewProvider({ children }: { children: ReactNode }) {
  const [developer, setDeveloperState] = useState(false);

  useEffect(() => {
    setDeveloperState(window.localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  const setDeveloper = (value: boolean) => {
    setDeveloperState(value);
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
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
