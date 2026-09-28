// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { isDialogOpen, isTypingTarget, resolveKey, SHORTCUTS, type KeyLike } from "@/shortcuts/shortcuts";

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
const free = { typing: false, dialogOpen: false };

afterEach(() => { document.body.innerHTML = ""; });

describe("resolveKey", () => {
  it("maps single keys, ? and g-sequences from the table", () => {
    expect(resolveKey(key("?", { shiftKey: true }), null, free).action).toBe("help");
    expect(resolveKey(key("p"), null, free).action).toBe("pause");
    expect(resolveKey(key("e"), null, free).action).toBe("edit");
    expect(resolveKey(key("t"), null, free).action).toBe("theme");
    expect(resolveKey(key("g"), null, free)).toEqual({ action: null, pending: "g" });
    for (const [k, id] of [["d", "go-dashboard"], ["l", "go-logs"], ["a", "go-apps"], ["c", "go-cron"], ["s", "go-settings"]]) {
      expect(resolveKey(key(k), "g", free).action).toBe(id);
    }
    expect(resolveKey(key("x"), "g", free)).toEqual({ action: null, pending: null }); // sequence broken
    expect(resolveKey(key("d"), null, free).action).toBeNull(); // "d" alone does nothing
  });

  it("Ctrl/⌘+K opens the palette, even while typing", () => {
    expect(resolveKey(key("k", { ctrlKey: true }), null, free).action).toBe("palette");
    expect(resolveKey(key("K", { metaKey: true }), null, { typing: true, dialogOpen: false }).action).toBe("palette");
  });

  it("ignores everything while a dialog is open (incl. Ctrl+K)", () => {
    const ctx = { typing: false, dialogOpen: true };
    for (const k of [key("k", { ctrlKey: true }), key("?", { shiftKey: true }), key("p"), key("g")]) {
      expect(resolveKey(k, null, ctx)).toEqual({ action: null, pending: null });
    }
    expect(resolveKey(key("l"), "g", ctx).action).toBeNull();
  });

  it("ignores single keys while typing", () => {
    const ctx = { typing: true, dialogOpen: false };
    for (const k of ["?", "p", "e", "g", "t", "r"]) expect(resolveKey(key(k, { shiftKey: k === "?" }), null, ctx).action).toBeNull();
    expect(resolveKey(key("l"), "g", ctx).action).toBeNull();
  });

  it("leaves browser/OS combos alone", () => {
    for (const mods of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }] as const) {
      for (const k of ["p", "r", "t", "e", "l", "f", "w"]) expect(resolveKey(key(k, mods), null, free).action).toBeNull();
    }
    expect(resolveKey(key("k", { ctrlKey: true, shiftKey: true }), null, free).action).toBeNull(); // Ctrl+Shift+K
    expect(resolveKey(key("k", { ctrlKey: true, altKey: true }), null, free).action).toBeNull();
    expect(resolveKey(key("P", { shiftKey: true }), null, free).action).toBeNull(); // Shift+letter
  });

  it("never maps a destructive action", () => {
    const ids = SHORTCUTS.map((s) => s.id).join(" ");
    expect(ids).not.toMatch(/update|reset|delete|stop|restart/i);
  });
});

describe("isTypingTarget / isDialogOpen", () => {
  it("detects inputs, textareas, selects and contenteditable", () => {
    document.body.innerHTML = '<input id="i"><textarea id="t"></textarea><select id="s"></select><div id="c" contenteditable="true"></div><button id="b"></button>';
    for (const id of ["i", "t", "s"]) expect(isTypingTarget(document.getElementById(id))).toBe(true);
    const ce = document.getElementById("c")!;
    Object.defineProperty(ce, "isContentEditable", { value: true }); // jsdom doesn't compute it
    expect(isTypingTarget(ce)).toBe(true);
    expect(isTypingTarget(document.getElementById("b"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it("sees open dialogs", () => {
    expect(isDialogOpen()).toBe(false);
    document.body.innerHTML = '<div role="dialog"></div>';
    expect(isDialogOpen()).toBe(true);
    document.body.innerHTML = '<div role="alertdialog"></div>';
    expect(isDialogOpen()).toBe(true);
  });
});
