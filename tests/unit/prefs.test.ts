import { describe, expect, it } from "vitest";
import {
  compact, defaultLayout, defaultPrefs, IMPORT_MAX_BYTES, loadPrefs, moveInOrder, parseImport, PREFS_BAD_KEY,
  PREFS_KEY, reconcile, savePrefs, serializePrefs, visibleLayout, type LayoutItem, type WidgetSizing,
} from "@/prefs/prefs";

const REG: WidgetSizing[] = [
  { id: "a", defaultSize: { w: 3, h: 4 }, minSize: { w: 2, h: 3 } },
  { id: "b", defaultSize: { w: 3, h: 4 } },
  { id: "c", defaultSize: { w: 6, h: 4 } },
  { id: "d", defaultSize: { w: 6, h: 8 }, maxSize: { w: 12, h: 10 } },
  { id: "e", defaultSize: { w: 6, h: 8 } },
];

class MemStore {
  data = new Map<string, string>();
  constructor(init: Record<string, string> = {}, private opts: { throwGet?: Error; throwSet?: Error } = {}) {
    for (const [k, v] of Object.entries(init)) this.data.set(k, v);
  }
  getItem(k: string) { if (this.opts.throwGet) throw this.opts.throwGet; return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { if (this.opts.throwSet) throw this.opts.throwSet; this.data.set(k, v); }
}
const domErr = (name: string) => Object.assign(new Error(name), { name });
const saved = (o: object) => ({ [PREFS_KEY]: JSON.stringify({ version: 1, ...o }) });
const order = (l: LayoutItem[]) => [...l].sort((p, q) => p.y - q.y || p.x - q.x).map((x) => x.i);

describe("default layout", () => {
  it("packs registry order left to right, like the P1 grid", () => {
    expect(defaultLayout(REG)).toEqual([
      { i: "a", x: 0, y: 0, w: 3, h: 4 },
      { i: "b", x: 3, y: 0, w: 3, h: 4 },
      { i: "c", x: 6, y: 0, w: 6, h: 4 },
      { i: "d", x: 0, y: 4, w: 6, h: 8 },
      { i: "e", x: 6, y: 4, w: 6, h: 8 },
    ]);
  });
});

describe("loadPrefs", () => {
  it("missing → defaults, no issue", () => {
    expect(loadPrefs(new MemStore(), REG)).toEqual({ prefs: defaultPrefs(REG), issue: null });
  });

  it("blocked storage → defaults in memory, 'blocked'", () => {
    const r = loadPrefs(new MemStore({}, { throwGet: domErr("SecurityError") }), REG);
    expect(r.issue).toEqual({ kind: "blocked" });
    expect(r.prefs).toEqual(defaultPrefs(REG));
    expect(loadPrefs(null, REG).issue).toEqual({ kind: "blocked" });
  });

  it.each([
    ["corrupt JSON", "{not json"],
    ["v0", JSON.stringify({ version: 0, layout: [] })],
    ["unknown version", JSON.stringify({ version: 3 })],
    ["no version", JSON.stringify({ layout: [] })],
    ["array", "[]"],
    ["null", "null"],
  ])("%s → defaults, raw value backed up to .bad", (_n, raw) => {
    const store = new MemStore({ [PREFS_KEY]: raw });
    const r = loadPrefs(store, REG);
    expect(r.issue).toEqual({ kind: "invalid" });
    expect(r.prefs).toEqual(defaultPrefs(REG));
    expect(store.data.get(PREFS_BAD_KEY)).toBe(raw);
  });

  it("one bad section falls back alone and is named", () => {
    const store = new MemStore(saved({ density: "compact", speed: "warp", hidden: ["b"] }));
    const r = loadPrefs(store, REG);
    expect(r.issue).toEqual({ kind: "sections", sections: ["speed"] });
    expect(r.prefs.speed).toBe("live");
    expect(r.prefs.density).toBe("compact");
    expect(r.prefs.hidden).toEqual(["b"]);
    expect(store.data.has(PREFS_BAD_KEY)).toBe(true);
  });

  it("names several bad sections", () => {
    const r = loadPrefs(new MemStore(saved({ layout: [{ i: "a" }], pins: "x" })), REG);
    expect(r.issue).toEqual({ kind: "sections", sections: ["layout", "pins"] });
    expect(r.prefs.layout).toEqual(defaultLayout(REG));
  });

  it("drops unknown ids, appends new ids at the bottom, keeps hidden ids hidden", () => {
    const layout = [
      { i: "e", x: 0, y: 0, w: 6, h: 8 },
      { i: "gone", x: 6, y: 0, w: 6, h: 4 },
      { i: "a", x: 6, y: 0, w: 3, h: 4 },
    ];
    const r = loadPrefs(new MemStore(saved({ layout, hidden: ["a", "gone", "a"] })), REG);
    expect(r.issue).toBeNull();
    expect(r.prefs.layout.find((l) => l.i === "gone")).toBeUndefined();
    expect(r.prefs.hidden).toEqual(["a"]);
    expect(order(r.prefs.layout)).toEqual(["e", "a", "b", "c", "d"]);
    const top = Math.min(...r.prefs.layout.filter((l) => ["b", "c", "d"].includes(l.i)).map((l) => l.y));
    expect(top).toBeGreaterThanOrEqual(8); // new ones below everything saved
  });

  it("clamps sizes to min/max and the 12 columns", () => {
    const layout = [{ i: "a", x: 11, y: 0, w: 1, h: 1 }, { i: "d", x: 0, y: 5, w: 20, h: 50 }];
    const { layout: out } = reconcile(layout, [], REG);
    expect(out.find((l) => l.i === "a")).toMatchObject({ w: 2, h: 3, x: 10 });
    expect(out.find((l) => l.i === "d")).toMatchObject({ w: 12, h: 10, x: 0 });
  });

  it("never loads `paused`", () => {
    const r = loadPrefs(new MemStore(saved({ paused: true })), REG);
    expect(r.prefs).not.toHaveProperty("paused");
  });
});

describe("savePrefs", () => {
  it("writes only persisted sections", () => {
    const store = new MemStore();
    const prefs = { ...defaultPrefs(REG), paused: true } as ReturnType<typeof defaultPrefs>;
    expect(savePrefs(store, prefs)).toBe("ok");
    const written = JSON.parse(store.data.get(PREFS_KEY)!);
    expect(Object.keys(written).sort()).toEqual(["density", "hidden", "layout", "layoutByHost", "pins", "speed", "version"]);
    expect(loadPrefs(store, REG)).toEqual({ prefs: defaultPrefs(REG), issue: null }); // round trip
  });

  it("quota exceeded → 'quota'; other failures → 'blocked'", () => {
    expect(savePrefs(new MemStore({}, { throwSet: domErr("QuotaExceededError") }), defaultPrefs(REG))).toBe("quota");
    expect(savePrefs(new MemStore({}, { throwSet: domErr("SecurityError") }), defaultPrefs(REG))).toBe("blocked");
    expect(savePrefs(null, defaultPrefs(REG))).toBe("blocked");
  });
});

describe("parseImport", () => {
  const good = serializePrefs({ ...defaultPrefs(REG), density: "compact", hidden: ["c"] });

  it("accepts an export", () => {
    const r = parseImport(good, REG);
    expect(r.ok && r.prefs.density).toBe("compact");
    expect(r.ok && r.prefs.hidden).toEqual(["c"]);
  });

  it("rejects non-JSON", () => {
    expect(parseImport("hello", REG)).toEqual({ ok: false, error: "Not valid JSON" });
  });

  it("rejects files over 64 KB", () => {
    const big = JSON.stringify({ pad: "x".repeat(IMPORT_MAX_BYTES) });
    expect(parseImport(big, REG)).toEqual({ ok: false, error: "File is larger than 64 KB" });
  });

  it("rejects unknown keys with the zod path", () => {
    const r = parseImport(JSON.stringify({ ...JSON.parse(good), paused: true }), REG);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/^\(root\): Unrecognized key/);
    const nested = JSON.parse(good);
    nested.layout[1].z = 1;
    expect(parseImport(JSON.stringify(nested), REG)).toMatchObject({ ok: false, error: expect.stringMatching(/^layout\.1: Unrecognized key/) });
  });

  it("rejects wrong types and versions with the path", () => {
    const bad = { ...JSON.parse(good), speed: "warp" };
    expect(parseImport(JSON.stringify(bad), REG)).toMatchObject({ ok: false, error: expect.stringMatching(/^speed: /) });
    expect(parseImport(JSON.stringify({ ...JSON.parse(good), version: 3 }), REG)).toMatchObject({ ok: false, error: expect.stringMatching(/^version: /) });
  });

  it("reconciles imported ids against the registry", () => {
    const withGhost = JSON.parse(good);
    withGhost.layout.push({ i: "ghost", x: 0, y: 99, w: 3, h: 4 });
    withGhost.hidden.push("ghost");
    const r = parseImport(JSON.stringify(withGhost), REG);
    expect(r.ok && r.prefs.layout.map((l) => l.i)).not.toContain("ghost");
    expect(r.ok && r.prefs.hidden).toEqual(["c"]);
  });
});

describe("layout ordering", () => {
  const base = { layout: defaultLayout(REG), hidden: [] as string[] };

  it("compact removes holes and resolves overlaps", () => {
    expect(compact([{ i: "x", x: 0, y: 10, w: 3, h: 2 }])).toEqual([{ i: "x", x: 0, y: 0, w: 3, h: 2 }]);
    expect(order(compact([{ i: "p", x: 0, y: 0, w: 6, h: 2 }, { i: "q", x: 3, y: 0, w: 6, h: 2 }]))).toEqual(["p", "q"]);
  });

  it("visibleLayout skips hidden cards and closes the gap", () => {
    const vis = visibleLayout({ ...base, hidden: ["a", "b", "c"] });
    expect(vis.map((l) => [l.i, l.y])).toEqual([["d", 0], ["e", 0]]);
  });

  it("moves a card one place in reading order, both ways", () => {
    expect(order(moveInOrder(base, "b", -1))).toEqual(["b", "a", "c", "d", "e"]);
    expect(order(moveInOrder(base, "a", 1))).toEqual(["b", "a", "c", "d", "e"]);
    expect(order(moveInOrder(base, "c", 1))).toEqual(["a", "b", "d", "c", "e"]); // different sizes
    expect(order(moveInOrder(base, "e", -1))).toEqual(["a", "b", "c", "e", "d"]);
  });

  it("is a no-op at the ends and ignores hidden neighbours", () => {
    expect(moveInOrder(base, "a", -1)).toEqual(base.layout);
    expect(moveInOrder(base, "e", 1)).toEqual(base.layout);
    const hid = { ...base, hidden: ["b"] };
    expect(order(visibleLayout({ layout: moveInOrder(hid, "c", -1), hidden: ["b"] }))).toEqual(["c", "a", "d", "e"]);
  });
});
