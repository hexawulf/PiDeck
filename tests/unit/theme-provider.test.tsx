// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import { installMatchMedia } from "./match-media";

function Probe() {
  const { theme, resolvedTheme, toggleTheme } = useTheme();
  return (
    <button onClick={toggleTheme} data-theme={theme} data-resolved={resolvedTheme}>
      toggle
    </button>
  );
}
const probe = () => screen.getByRole("button");
const htmlClass = () => document.documentElement.className;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
});
afterEach(cleanup);

describe("ThemeProvider", () => {
  it("adopts the class the no-flash script already set (does not re-resolve)", () => {
    installMatchMedia(false); // OS says light …
    document.documentElement.className = "dark"; // … but the script decided dark
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(probe().dataset.resolved).toBe("dark");
    expect(htmlClass()).toBe("dark");
  });

  it("resolves itself when no class is present", () => {
    installMatchMedia(true);
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(probe().dataset.resolved).toBe("dark");
    expect(htmlClass()).toBe("dark");
  });

  it("toggle stores the explicit opposite (dark → light → dark)", () => {
    installMatchMedia(false);
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeProvider><Probe /></ThemeProvider>);
    act(() => probe().click());
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(htmlClass()).toBe("light");
    act(() => probe().click());
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(htmlClass()).toBe("dark");
  });

  it("toggle while 'system' stores the opposite of the OS (regression: dashboard.tsx:107)", () => {
    installMatchMedia(true);
    localStorage.setItem(THEME_STORAGE_KEY, "system");
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(probe().dataset.resolved).toBe("dark");
    act(() => probe().click());
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(htmlClass()).toBe("light");
  });

  it("follows OS changes while 'system'", () => {
    const mm = installMatchMedia(false);
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(htmlClass()).toBe("light");
    act(() => mm.setDark(true));
    expect(htmlClass()).toBe("dark");
    expect(probe().dataset.resolved).toBe("dark");
  });

  it("ignores OS changes after an explicit choice", () => {
    const mm = installMatchMedia(false);
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(mm.listenerCount()).toBe(0);
    act(() => mm.setDark(true));
    expect(htmlClass()).toBe("light");
  });

  it("removes the OS listener on unmount and after choosing explicitly", () => {
    const mm = installMatchMedia(false);
    const { unmount } = render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(mm.listenerCount()).toBe(1);
    act(() => probe().click()); // explicit choice
    expect(mm.listenerCount()).toBe(0);
    unmount();
    expect(mm.listenerCount()).toBe(0);
  });

  it("useTheme outside the provider throws", () => {
    expect(() => render(<Probe />)).toThrow(/within a ThemeProvider/);
  });
});
