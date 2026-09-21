// @vitest-environment jsdom
// lib/theme.ts + parity with the no-flash script in client/index.html:
// the inline script is executed here for every stored × OS combination and
// must agree with resolveTheme().
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  THEME_STORAGE_KEY,
  readStoredTheme,
  resolveTheme,
  writeStoredTheme,
  type Theme,
} from "@/lib/theme";
import { installMatchMedia } from "./match-media";

const html = fs.readFileSync(path.resolve(__dirname, "../../client/index.html"), "utf8");
const inlineScript = /<script>([\s\S]*?)<\/script>/.exec(html)![1];

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
});
afterEach(() => vi.restoreAllMocks());

describe("resolveTheme", () => {
  it.each([
    ["light", false, "light"], ["light", true, "light"],
    ["dark", false, "dark"], ["dark", true, "dark"],
    ["system", false, "light"], ["system", true, "dark"],
  ] as const)("%s + prefersDark=%s → %s", (t, dark, expected) => {
    expect(resolveTheme(t, dark)).toBe(expected);
  });
});

describe("storage", () => {
  it("defaults to system when nothing or garbage is stored", () => {
    expect(readStoredTheme()).toBe("system");
    localStorage.setItem(THEME_STORAGE_KEY, "purple");
    expect(readStoredTheme()).toBe("system");
  });

  it("round-trips a valid theme", () => {
    writeStoredTheme("light");
    expect(readStoredTheme()).toBe("light");
  });

  it("survives blocked storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readStoredTheme()).toBe("system");
    expect(() => writeStoredTheme("dark")).not.toThrow();
  });
});

describe("index.html no-flash script", () => {
  it("uses the same storage key", () => {
    expect(inlineScript).toContain(`"${THEME_STORAGE_KEY}"`);
  });

  const stored: (Theme | null)[] = ["light", "dark", "system", null];
  for (const s of stored) {
    for (const osDark of [false, true]) {
      it(`stored=${s} osDark=${osDark} matches resolveTheme`, () => {
        installMatchMedia(osDark);
        if (s) localStorage.setItem(THEME_STORAGE_KEY, s);
        new Function(inlineScript)();
        const expected = resolveTheme(s ?? "system", osDark);
        expect(document.documentElement.classList.contains(expected)).toBe(true);
        expect(document.documentElement.classList.length).toBe(1);
      });
    }
  }

  it("falls back to the OS when storage throws", () => {
    installMatchMedia(true);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => new Function(inlineScript)()).not.toThrow();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
