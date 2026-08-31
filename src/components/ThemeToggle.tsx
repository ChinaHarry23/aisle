"use client";

import { applyTheme, UI_THEMES, type UiTheme } from "@/lib/theme";
import { useAisle } from "@/lib/store";

export function ThemeToggle() {
  const theme = useAisle((s) => s.settings.theme);
  const updateSettings = useAisle((s) => s.updateSettings);

  function select(next: UiTheme) {
    updateSettings({ theme: next });
    applyTheme(next);
  }

  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Interface theme">
      {UI_THEMES.map((item) => {
        const active = theme === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={item.hint}
            onClick={() => select(item.id)}
            className={active ? "is-on" : undefined}
          >
            <span className="theme-toggle-label">{item.label}</span>
            <span className="theme-toggle-hint">{item.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
