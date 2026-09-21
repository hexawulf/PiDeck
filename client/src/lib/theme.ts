// Theme resolution shared by ThemeProvider.
// The no-flash script in client/index.html repeats resolveTheme() in plain
// JS because it must run before any module loads; keep the two in sync
// (tests/unit/theme.test.ts checks the storage key and CSP hash).
//
//   stored: "light" | "dark"      → that theme, OS changes ignored
//   stored: "system" | missing    → follow prefers-color-scheme, live
export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "pideck-ui-theme";
export const DARK_QUERY = "(prefers-color-scheme: dark)";

export function readStoredTheme(): Theme {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    return "system"; // storage blocked (privacy mode, sandboxed iframe)
  }
}

export function writeStoredTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Not persisted; the choice still applies for this page view.
  }
}

export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
}

export function resolveTheme(theme: Theme, prefersDark: boolean): ResolvedTheme {
  if (theme === "system") return prefersDark ? "dark" : "light";
  return theme;
}

export function applyTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
}

// The class the no-flash script already put on <html>, if any.
export function themeFromDocument(): ResolvedTheme | null {
  const cl = document.documentElement.classList;
  if (cl.contains("dark")) return "dark";
  if (cl.contains("light")) return "light";
  return null;
}
