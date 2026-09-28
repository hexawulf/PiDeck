/*
 * Keyboard shortcuts: the one table (the ? help sheet renders it) and a pure
 * resolver the global keydown handler calls.
 * ────────────────────────────────────────────────────────────────────
 *   keydown ─┬─ Ctrl/⌘+K ─────────────────────────► palette (also in inputs)
 *            ├─ a dialog is open ─────────────────► ignore (dialogs own keys)
 *            ├─ other Ctrl/⌘/Alt combo ───────────► ignore (browser/OS keep them)
 *            ├─ typing (input/textarea/select/     ► ignore
 *            │   contenteditable)
 *            ├─ "?" ──────────────────────────────► help sheet
 *            ├─ Shift+letter ─────────────────────► ignore
 *            ├─ pending "g" + d/l/a/c/s ─────────► go to tab (d/a stay on the
 *            │                                        current host; h opens the host switcher)
 *            └─ single key e/p/r/t, or "g" (starts a 1.5s sequence)
 *
 * Nothing destructive is ever a shortcut: Update System and Reset all are
 * reachable only through buttons/palette and a ConfirmDialog.
 */
export type ShortcutId =
  | "palette" | "help"
  | "go-dashboard" | "go-logs" | "go-apps" | "go-cron" | "go-settings" | "go-hosts"
  | "edit" | "pause" | "refresh" | "theme";

export type Shortcut = { id: ShortcutId; keys: string[]; label: string; group: "General" | "Go to" | "Dashboard" };

export const SHORTCUTS: readonly Shortcut[] = [
  { id: "palette", keys: ["Mod", "K"], label: "Open command palette", group: "General" },
  { id: "help", keys: ["?"], label: "Show keyboard shortcuts", group: "General" },
  { id: "theme", keys: ["t"], label: "Toggle light / dark theme", group: "General" },
  { id: "go-dashboard", keys: ["g", "d"], label: "Go to Dashboard", group: "Go to" },
  { id: "go-logs", keys: ["g", "l"], label: "Go to Logs", group: "Go to" },
  { id: "go-apps", keys: ["g", "a"], label: "Go to Apps", group: "Go to" },
  { id: "go-cron", keys: ["g", "c"], label: "Go to Cron", group: "Go to" },
  { id: "go-settings", keys: ["g", "s"], label: "Go to Settings", group: "Go to" },
  { id: "go-hosts", keys: ["g", "h"], label: "Open the host list", group: "Go to" },
  { id: "edit", keys: ["e"], label: "Edit layout / done (dashboard, wide screens)", group: "Dashboard" },
  { id: "pause", keys: ["p"], label: "Pause / resume auto-refresh", group: "Dashboard" },
  { id: "refresh", keys: ["r"], label: "Refresh now", group: "Dashboard" },
];

export const SEQUENCE_TIMEOUT_MS = 1500;

export type KeyLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;
export type KeyContext = { typing: boolean; dialogOpen: boolean };
export type Resolution = { action: ShortcutId | null; pending: string | null };

/** True when keys should go to the focused control, not to shortcuts. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable === true;
}

export function isDialogOpen(doc: Document = document): boolean {
  return doc.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

// Built from the table so the help sheet and the resolver can't drift.
const SINGLE = new Map(SHORTCUTS.filter((s) => s.keys.length === 1 && s.keys[0] !== "?").map((s) => [s.keys[0], s.id]));
const AFTER_G = new Map(SHORTCUTS.filter((s) => s.keys.length === 2 && s.keys[0] === "g").map((s) => [s.keys[1], s.id]));

export function resolveKey(e: KeyLike, pending: string | null, ctx: KeyContext): Resolution {
  const key = e.key;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && key.toLowerCase() === "k") {
    return { action: ctx.dialogOpen ? null : "palette", pending: null };
  }
  if (ctx.dialogOpen || e.ctrlKey || e.metaKey || e.altKey || ctx.typing) return { action: null, pending: null };
  if (key === "?") return { action: "help", pending: null };
  if (e.shiftKey) return { action: null, pending: null };
  if (pending === "g") return { action: AFTER_G.get(key) ?? null, pending: null };
  if (key === "g") return { action: null, pending: "g" };
  return { action: SINGLE.get(key) ?? null, pending: null };
}

/** How a key is shown in the help sheet. */
export function keyLabel(k: string, mac: boolean): string {
  return k === "Mod" ? (mac ? "⌘" : "Ctrl") : k;
}
