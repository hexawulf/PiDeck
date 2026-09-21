import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  type ResolvedTheme,
  type Theme,
  DARK_QUERY,
  applyTheme,
  readStoredTheme,
  resolveTheme,
  systemPrefersDark,
  themeFromDocument,
  writeStoredTheme,
} from "@/lib/theme";

// Load:    client/index.html script resolves + sets <html class>; we adopt it.
// Runtime: toggle() stores an explicit light/dark; while the stored value is
//          "system" we follow OS changes via matchMedia.

type ThemeProviderState = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(
    () => themeFromDocument() ?? resolveTheme(readStoredTheme(), systemPrefersDark()),
  );

  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    if (theme !== "system" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(DARK_QUERY);
    const onChange = (e: MediaQueryListEvent) => setResolvedTheme(e.matches ? "dark" : "light");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    writeStoredTheme(next);
    setThemeState(next);
    setResolvedTheme(resolveTheme(next, systemPrefersDark()));
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setTheme]);

  return (
    <ThemeProviderContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme }}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export function useTheme(): ThemeProviderState {
  const context = useContext(ThemeProviderContext);
  if (context === undefined) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
}
