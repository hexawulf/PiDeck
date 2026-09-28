/*
 * UI preferences in localStorage ("pideck:prefs:v1").
 * ────────────────────────────────────────────────────────────────────
 *  load:  getItem ──throws──► blocked: defaults in memory, toast once
 *           │ null ─────────► defaults (first visit, no toast)
 *           ▼
 *         JSON.parse ──fails──► back up raw to "…v1.bad", defaults, toast
 *           ▼
 *         version 1 or 2 ? ──no──► same as above (unknown version)
 *           │ 1 → migrate: no layoutByHost yet (= every host uses the local layout)
 *           ▼
 *         per-section zod (layout · hidden · density · speed · pins · layoutByHost)
 *           │  a bad section falls back alone; the toast names it (E3)
 *           ▼
 *         reconcile(registry): drop unknown ids, append new ids at the
 *           bottom, clamp sizes, keep hidden ids hidden, compact — the local
 *           layout against every widget, each remote host's against the
 *           `hosts: "any"` widgets
 *
 *  save:  only persisted sections (never `paused`) → setItem
 *           QuotaExceededError → keep in memory, toast "Couldn't save layout"
 *  other tabs: 'storage' event → load() again (UiPrefsProvider)
 *
 * Pure module: no React, no react-grid-layout (keeps RGL out of the main chunk).
 */
import { z } from "zod";

export const PREFS_KEY = "pideck:prefs:v1";
export const PREFS_BAD_KEY = `${PREFS_KEY}.bad`;
export const PREFS_VERSION = 2; // 2: layoutByHost (multi-host H1); 1 still loads and imports
export const GRID_COLS = 12;
export const IMPORT_MAX_BYTES = 64 * 1024;

// ── schemas ──────────────────────────────────────────────────────────
const int = z.number().int();
export const layoutItemSchema = z
  .object({ i: z.string().min(1).max(64), x: int.min(0), y: int.min(0), w: int.min(1), h: int.min(1) })
  .strict();
export const densitySchema = z.enum(["comfortable", "compact"]);
export const speedSchema = z.enum(["live", "relaxed", "slow"]);
/** Reserved for P3 log pins; nothing reads or writes it yet. */
export const pinSchema = z
  .object({ logId: z.string().max(200), label: z.string().max(200).optional(), grep: z.string().max(200).optional() })
  .strict();

const layoutSchema = z.array(layoutItemSchema).max(200);
const hiddenSchema = z.array(z.string().max(64)).max(200);
export const MAX_HOST_LAYOUTS = 32;
/** One remote host's dashboard; the local one stays in `layout`/`hidden`. */
export const hostLayoutSchema = z.object({ layout: layoutSchema, hidden: hiddenSchema }).strict();
export const layoutByHostSchema = z
  .record(z.string().regex(/^[a-z0-9-]{1,32}$/), hostLayoutSchema)
  .refine((o) => Object.keys(o).length <= MAX_HOST_LAYOUTS, `at most ${MAX_HOST_LAYOUTS} hosts`)
  .refine((o) => !("local" in o), "the local layout is `layout`, not layoutByHost.local");

export const SECTIONS = {
  layout: layoutSchema,
  hidden: hiddenSchema,
  density: densitySchema,
  speed: speedSchema,
  pins: z.array(pinSchema).max(100),
  layoutByHost: layoutByHostSchema,
} as const;
export type SectionName = keyof typeof SECTIONS;

/** Import accepts only these exact shapes (unknown keys rejected): the current file, or a v1 file. */
export const importSchema = z
  .object({ version: z.literal(PREFS_VERSION), ...SECTIONS })
  .strict();
const { layoutByHost: _v2only, ...V1_SECTIONS } = SECTIONS;
export const importSchemaV1 = z.object({ version: z.literal(1), ...V1_SECTIONS }).strict();

export type LayoutItem = z.infer<typeof layoutItemSchema>;
export type Density = z.infer<typeof densitySchema>;
export type Speed = z.infer<typeof speedSchema>;
export type Pin = z.infer<typeof pinSchema>;
export type HostLayout = z.infer<typeof hostLayoutSchema>;
export type PersistedPrefs = { [K in SectionName]: z.infer<(typeof SECTIONS)[K]> };

/** What prefs needs to know about a widget (a subset of WidgetDef). */
export type WidgetSizing = {
  id: string;
  defaultSize: { w: number; h: number };
  minSize?: { w: number; h: number };
  maxSize?: { w: number; h: number };
  hosts?: "local" | "any";
};

/** The widgets a remote host's dashboard can show. */
export const remoteRegistry = (registry: readonly WidgetSizing[]) => registry.filter((d) => (d.hosts ?? "any") === "any");

// ── layout geometry ──────────────────────────────────────────────────
const collides = (a: LayoutItem, b: LayoutItem) =>
  a.i !== b.i && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Order cards are read in: top to bottom, then left to right. */
export const byRowCol = (a: LayoutItem, b: LayoutItem) => a.y - b.y || a.x - b.x;

/** Vertical compaction, same rules as react-grid-layout's verticalCompactor. */
export function compact(items: readonly LayoutItem[]): LayoutItem[] {
  const placed: LayoutItem[] = [];
  for (const item of [...items].sort(byRowCol)) {
    const l = { ...item };
    for (let hit = placed.find((p) => collides(l, p)); hit; hit = placed.find((p) => collides(l, p))) {
      l.y = hit.y + hit.h;
    }
    while (l.y > 0 && !placed.some((p) => collides({ ...l, y: l.y - 1 }, p))) l.y--;
    placed.push(l);
  }
  return placed.sort(byRowCol);
}

function clampSize(item: LayoutItem, def: WidgetSizing): LayoutItem {
  const min = def.minSize ?? { w: 1, h: 1 };
  const max = def.maxSize ?? { w: GRID_COLS, h: 100 };
  const w = Math.min(Math.max(item.w, min.w), max.w, GRID_COLS);
  const h = Math.min(Math.max(item.h, min.h), max.h);
  return { ...item, w, h, x: Math.min(item.x, GRID_COLS - w) };
}

/** Pack widgets left to right in registry order, like the P1 CSS grid. */
function pack(defs: readonly WidgetSizing[], startY = 0): LayoutItem[] {
  const out: LayoutItem[] = [];
  let x = 0;
  let y = startY;
  let rowH = 0;
  for (const d of defs) {
    const { w, h } = d.defaultSize;
    if (x + w > GRID_COLS) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    out.push({ i: d.id, x, y, w, h });
    x += w;
    rowH = Math.max(rowH, h);
  }
  return out;
}

export function defaultLayout(registry: readonly WidgetSizing[]): LayoutItem[] {
  return compact(pack(registry));
}

export function defaultPrefs(registry: readonly WidgetSizing[]): PersistedPrefs {
  return { layout: defaultLayout(registry), hidden: [], density: "comfortable", speed: "live", pins: [], layoutByHost: {} };
}

/** Make a layout/hidden pair valid for the current registry. */
export function reconcile(
  layout: readonly LayoutItem[],
  hidden: readonly string[],
  registry: readonly WidgetSizing[],
): { layout: LayoutItem[]; hidden: string[] } {
  const defs = new Map(registry.map((d) => [d.id, d]));
  const seen = new Set<string>();
  const kept: LayoutItem[] = [];
  for (const item of layout) {
    const def = defs.get(item.i);
    if (!def || seen.has(item.i)) continue; // unknown or duplicate id
    seen.add(item.i);
    kept.push(clampSize(item, def));
  }
  const bottom = kept.reduce((m, l) => Math.max(m, l.y + l.h), 0);
  const added = pack(registry.filter((d) => !seen.has(d.id)), bottom); // new widgets go at the bottom
  return {
    layout: compact([...kept, ...added]),
    hidden: [...new Set(hidden)].filter((id) => defs.has(id)),
  };
}

/** Reconcile every remote host's saved layout against the remote registry. */
export function reconcileHosts(
  byHost: Readonly<Record<string, HostLayout>>,
  registry: readonly WidgetSizing[],
): Record<string, HostLayout> {
  const remote = remoteRegistry(registry);
  const out: Record<string, HostLayout> = {};
  for (const [id, l] of Object.entries(byHost)) if (id !== "local") out[id] = reconcile(l.layout, l.hidden, remote);
  return out;
}

/**
 * A host's layout: the local one for "local"; for a remote host its own
 * saved layout, or — until it has one — the local layout minus local-only
 * widgets (plan › Layout prefs: "falling back to the local layout").
 */
export function hostLayout(
  prefs: Pick<PersistedPrefs, "layout" | "hidden" | "layoutByHost">,
  hostId: string,
  registry: readonly WidgetSizing[],
): HostLayout {
  if (hostId === "local") return { layout: prefs.layout, hidden: prefs.hidden };
  return prefs.layoutByHost[hostId] ?? reconcile(prefs.layout, prefs.hidden, remoteRegistry(registry));
}

/** Prefs with one host's layout/hidden changed (a remote host gets its own entry from now on). */
export function withHostLayout(
  prefs: PersistedPrefs,
  hostId: string,
  change: Partial<HostLayout>,
  registry: readonly WidgetSizing[],
): PersistedPrefs {
  if (hostId === "local") return { ...prefs, ...change };
  const current = hostLayout(prefs, hostId, registry);
  return { ...prefs, layoutByHost: { ...prefs.layoutByHost, [hostId]: { ...current, ...change } } };
}

/** The visible cards, compacted as the grid will show them, in reading order. */
export function visibleLayout(prefs: Pick<PersistedPrefs, "layout" | "hidden">): LayoutItem[] {
  const hidden = new Set(prefs.hidden);
  return compact(prefs.layout.filter((l) => !hidden.has(l.i)));
}

/** Write a changed visible layout back, leaving hidden cards' saved slots alone. */
export function mergeVisible(all: readonly LayoutItem[], visible: readonly LayoutItem[]): LayoutItem[] {
  const next = new Map(visible.map((l) => [l.i, { i: l.i, x: l.x, y: l.y, w: l.w, h: l.h }]));
  return all.map((l) => next.get(l.i) ?? l);
}

/**
 * Keyboard reordering: move a card one place earlier/later in reading order.
 * Swapping the two cards' positions keeps custom arrangements; when card
 * sizes differ and the swap doesn't produce the requested order, fall back
 * to re-packing the visible cards (sizes kept) in that order.
 */
export function moveInOrder(prefs: Pick<PersistedPrefs, "layout" | "hidden">, id: string, dir: -1 | 1): LayoutItem[] {
  const vis = visibleLayout(prefs);
  const idx = vis.findIndex((l) => l.i === id);
  const other = vis[idx + dir];
  if (idx < 0 || !other) return prefs.layout.slice();
  const me = vis[idx];
  const wanted = vis.map((l) => l.i);
  [wanted[idx], wanted[idx + dir]] = [wanted[idx + dir], wanted[idx]];

  const swapped = compact(
    vis.map((l) => {
      if (l.i === me.i) return { ...l, x: Math.min(other.x, GRID_COLS - l.w), y: other.y };
      if (l.i === other.i) return { ...l, x: Math.min(me.x, GRID_COLS - l.w), y: me.y };
      return l;
    }),
  );
  if (swapped.map((l) => l.i).join() === wanted.join()) return mergeVisible(prefs.layout, swapped);

  const sizes = new Map(vis.map((l) => [l.i, l]));
  const repacked = pack(wanted.map((i) => ({ id: i, defaultSize: { w: sizes.get(i)!.w, h: sizes.get(i)!.h } })));
  return mergeVisible(prefs.layout, compact(repacked));
}

// ── storage ──────────────────────────────────────────────────────────
export type Store = Pick<Storage, "getItem" | "setItem">;

export type LoadIssue =
  | { kind: "blocked" }
  | { kind: "invalid" } // whole value unusable (corrupt JSON, not an object, other version)
  | { kind: "sections"; sections: SectionName[] };

export type LoadResult = { prefs: PersistedPrefs; issue: LoadIssue | null };

function backup(store: Store, raw: string) {
  try {
    store.setItem(PREFS_BAD_KEY, raw);
  } catch {
    /* best effort */
  }
}

export function loadPrefs(store: Store | null, registry: readonly WidgetSizing[]): LoadResult {
  const defaults = defaultPrefs(registry);
  let raw: string | null;
  try {
    if (!store) throw new Error("no storage");
    raw = store.getItem(PREFS_KEY);
  } catch {
    return { prefs: defaults, issue: { kind: "blocked" } };
  }
  if (raw === null) return { prefs: defaults, issue: null };

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    backup(store, raw);
    return { prefs: defaults, issue: { kind: "invalid" } };
  }
  const version = (data as { version?: unknown } | null)?.version;
  if (typeof data !== "object" || data === null || Array.isArray(data) || (version !== PREFS_VERSION && version !== 1)) {
    backup(store, raw);
    return { prefs: defaults, issue: { kind: "invalid" } };
  }

  // v1 → v2: the only change is the new layoutByHost section, which a v1
  // value simply lacks (a missing section is the default: {}).
  const obj = data as Record<string, unknown>;
  const bad: SectionName[] = [];
  const out = { ...defaults } as Record<SectionName, unknown>;
  for (const name of Object.keys(SECTIONS) as SectionName[]) {
    if (!(name in obj)) continue; // missing section → default, not an error
    const parsed = SECTIONS[name].safeParse(obj[name]);
    if (parsed.success) out[name] = parsed.data;
    else bad.push(name);
  }
  const prefs = out as PersistedPrefs;
  Object.assign(prefs, reconcile(prefs.layout, prefs.hidden, registry));
  prefs.layoutByHost = reconcileHosts(prefs.layoutByHost, registry);
  if (bad.length) backup(store, raw);
  return { prefs, issue: bad.length ? { kind: "sections", sections: bad } : null };
}

export function serializePrefs(prefs: PersistedPrefs): string {
  const { layout, hidden, density, speed, pins, layoutByHost } = prefs; // explicit: nothing session-only leaks in
  return JSON.stringify({ version: PREFS_VERSION, layout, hidden, density, speed, pins, layoutByHost });
}

export type SaveResult = "ok" | "quota" | "blocked";

export function savePrefs(store: Store | null, prefs: PersistedPrefs): SaveResult {
  if (!store) return "blocked";
  try {
    store.setItem(PREFS_KEY, serializePrefs(prefs));
    return "ok";
  } catch (err) {
    const name = (err as { name?: string })?.name;
    const code = (err as { code?: number })?.code;
    if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22) return "quota";
    return "blocked";
  }
}

/** Import from a user file. Never throws; returns prefs or a message with the zod path. */
export function parseImport(
  text: string,
  registry: readonly WidgetSizing[],
): { ok: true; prefs: PersistedPrefs } | { ok: false; error: string } {
  if (new TextEncoder().encode(text).length > IMPORT_MAX_BYTES) {
    return { ok: false, error: `File is larger than ${IMPORT_MAX_BYTES / 1024} KB` };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not valid JSON" };
  }
  const isV1 = (data as { version?: unknown } | null)?.version === 1;
  const parsed = isV1
    ? importSchemaV1.transform((d) => ({ ...d, layoutByHost: {} }))
        .safeParse(data)
    : importSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue.path.join(".") || "(root)"}: ${issue.message}` };
  }
  const { version: _v, ...prefs } = parsed.data;
  return {
    ok: true,
    prefs: { ...prefs, ...reconcile(prefs.layout, prefs.hidden, registry), layoutByHost: reconcileHosts(prefs.layoutByHost, registry) },
  };
}

/** localStorage, or null when the browser refuses access to it. */
export function browserStore(): Store | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null; // SecurityError: storage disabled
  }
}
