/*
 * Palette action registry (lazy chunk only). buildActions(ctx) returns every
 * action for the current state; CommandPalette filters them with fuzzyFilter.
 * To add one: push an entry here — label, group, keywords, perform().
 * Destructive actions must not act directly: Update System only opens the
 * ConfirmDialog (E7).
 */
import type { LogEntry } from "@/hooks/use-host-logs";
import { logHref } from "@/hooks/use-host-logs";
import type { Density } from "@/prefs/prefs";
import { hostHref, REMOTE_TABS } from "@/hosts/host-path";

export type PaletteGroup = "Navigate" | "Hosts" | "View" | "Refresh" | "Log pins" | "Logs" | "System" | "Help";

export type PaletteAction = {
  id: string;
  group: PaletteGroup;
  label: string;
  hint?: string;
  keywords?: string[];
  /** Greyed out but still listed (e.g. a pin whose file is gone). */
  muted?: boolean;
  perform: () => void;
};

export type PalettePin = { logId: string; label?: string; grep?: string; stale: boolean };
export type PaletteHost = { id: string; label: string; status: string };

export type PaletteContext = {
  navigate: (to: string) => void;
  path: string;
  canEdit: boolean;
  editing: boolean;
  setEditing: (editing: boolean) => void;
  resolvedTheme: "light" | "dark";
  toggleTheme: () => void;
  density: Density;
  setDensity: (d: Density) => void;
  paused: boolean;
  setPaused: (paused: boolean) => void;
  refresh: () => void;
  logs: readonly LogEntry[];
  pins: readonly PalettePin[];
  requestUpdate: () => void;
  showHelp: () => void;
  /** Current host ("local" = the hub) and every host the hub knows. */
  hostId?: string;
  hosts?: readonly PaletteHost[];
};

const isRemoteTab = (tab: string) => (REMOTE_TABS as readonly string[]).includes(tab);

const TABS = [
  ["dashboard", "Dashboard"], ["logs", "Logs"], ["apps", "Apps"], ["cron", "Cron"], ["settings", "Settings"],
] as const;

export function buildActions(input: PaletteContext): PaletteAction[] {
  const ctx = { ...input, hostId: input.hostId ?? "local", hosts: input.hosts ?? [] };
  const actions: PaletteAction[] = [];

  // Dashboard and Apps stay on the current host; Logs, Cron and Settings are the hub's.
  for (const [id, label] of TABS) {
    const href = isRemoteTab(id) ? hostHref(ctx.hostId, id) : `/${id}`;
    actions.push({
      id: `go-${id}`, group: "Navigate", label: `Go to ${label}`, keywords: [label, id],
      hint: ctx.path === href ? "current" : undefined,
      perform: () => ctx.navigate(href),
    });
  }

  if (ctx.hosts.length > 1) {
    actions.push({
      id: "go-overview", group: "Hosts", label: "Go to All hosts", keywords: ["overview", "hosts", "fleet", "all"],
      hint: ctx.path === "/hosts" ? "current" : undefined,
      perform: () => ctx.navigate("/hosts"),
    });
    const last = ctx.path.split("/").pop() ?? "dashboard";
    const tab = last === "hosts" ? "dashboard" : last;
    for (const h of ctx.hosts) {
      actions.push({
        id: `host:${h.id}`, group: "Hosts", label: `Switch to ${h.label}`,
        hint: h.id === ctx.hostId ? "current" : h.status === "online" ? undefined : h.status,
        keywords: ["host", "switch", "machine", h.id, h.label],
        perform: () => ctx.navigate(hostHref(h.id, h.id === "local" || isRemoteTab(tab) ? tab : "dashboard")),
      });
    }
  }

  const nextTheme = ctx.resolvedTheme === "dark" ? "light" : "dark";
  actions.push({ id: "theme", group: "View", label: `Switch to ${nextTheme} theme`, keywords: ["theme", "dark", "light", "mode"], perform: ctx.toggleTheme });
  const nextDensity: Density = ctx.density === "compact" ? "comfortable" : "compact";
  actions.push({
    id: "density", group: "View", label: `Use ${nextDensity} density`, keywords: ["density", "dense", "compact", "comfortable"],
    perform: () => ctx.setDensity(nextDensity),
  });
  if (ctx.canEdit) {
    actions.push({
      id: "edit", group: "View", label: ctx.editing ? "Finish editing layout" : "Edit dashboard layout",
      keywords: ["edit", "layout", "grid", "arrange", "done"], perform: () => ctx.setEditing(!ctx.editing),
    });
  }

  actions.push({
    id: "pause", group: "Refresh", label: ctx.paused ? "Resume auto-refresh" : "Pause auto-refresh",
    keywords: ["pause", "resume", "polling", "stop"], perform: () => ctx.setPaused(!ctx.paused),
  });
  actions.push({ id: "refresh", group: "Refresh", label: "Refresh now", keywords: ["reload", "refetch", "update data"], perform: ctx.refresh });

  for (const pin of ctx.pins) {
    const name = pin.label ?? pin.logId;
    actions.push({
      id: `pin:${pin.logId}:${pin.grep ?? ""}`, group: "Log pins",
      label: pin.grep ? `${name} — “${pin.grep}”` : name,
      hint: pin.stale ? "file no longer available" : "pinned",
      muted: pin.stale, keywords: [pin.logId, pin.grep ?? ""],
      perform: () => ctx.navigate(logHref(pin.logId, pin.grep)),
    });
  }
  for (const log of ctx.logs) {
    actions.push({
      id: `log:${log.id}`, group: "Logs", label: `Open log: ${log.label || log.name}`, keywords: [log.name, log.source],
      perform: () => ctx.navigate(logHref(log.id)),
    });
  }

  // The hub's own system only (agents are read-only in H1).
  if (ctx.hostId === "local") {
    actions.push({
      id: "update-system", group: "System", label: "Update system…", hint: "asks first",
      keywords: ["apt", "upgrade", "packages"], perform: ctx.requestUpdate,
    });
  }
  actions.push({ id: "help", group: "Help", label: "Keyboard shortcuts", hint: "?", keywords: ["keys", "help", "shortcuts"], perform: ctx.showHelp });
  return actions;
}
