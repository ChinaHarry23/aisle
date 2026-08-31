export type UiTheme = "simple" | "desk" | "dev";

export const THEME_STORAGE_KEY = "aisle-theme";

export const UI_THEMES: { id: UiTheme; label: string; hint: string }[] = [
  { id: "simple", label: "Simple", hint: "Founder view" },
  { id: "desk", label: "Desk", hint: "Marketing ops" },
  { id: "dev", label: "Dev", hint: "Engineer" },
];

export function isUiTheme(value: unknown): value is UiTheme {
  return value === "simple" || value === "desk" || value === "dev";
}

export function applyTheme(theme: UiTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode */
  }
}

export function readStoredTheme(): UiTheme {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (isUiTheme(value)) return value;
  } catch {
    /* private mode */
  }
  return "simple";
}
