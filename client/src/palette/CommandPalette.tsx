/*
 * Lazy chunk (E23): the command palette and the shortcut help sheet. Loaded on
 * first Ctrl/⌘+K, header button or "?"; the main chunk only carries the
 * trigger (components/command-center.tsx) and the shortcut table.
 *
 *   input (role=combobox) ──aria-activedescendant──► listbox ─ group ─ option…
 *   ↑/↓ move · Enter runs · Esc closes (Radix) · typing filters (fuzzyFilter)
 */
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Search } from "lucide-react";
import { useLocation } from "wouter";
import { useTheme } from "@/components/theme-provider";
import { UpdateSystemConfirm } from "@/components/update-system-confirm";
import { MD_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { useHostLogs } from "@/hooks/use-host-logs";
import { useLogPins } from "@/hooks/use-log-pins";
import { useRefreshAll } from "@/hooks/use-refresh-all";
import { useUiPrefs, useUiPrefsDispatch } from "@/prefs/UiPrefsProvider";
import { keyLabel, SHORTCUTS, type Shortcut } from "@/shortcuts/shortcuts";
import { cn } from "@/lib/utils";
import { buildActions, type PaletteAction } from "./actions";
import { useHost, useHosts } from "@/hosts/HostProvider";
import { fuzzyFilter } from "./fuzzy";

const MAX_RESULTS = 60;
const SCRIM = "fixed inset-0 z-50 bg-black/50"; // theme-ok: a dimming scrim is black in both themes
const panel =
  "fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border border-pi-border bg-pi-card text-pi-text shadow-xl";

/** Radix only restores focus to a DialogTrigger; these open from state. */
function useOpener(open: boolean) {
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) opener.current = document.activeElement as HTMLElement | null;
  }, [open]);
  return opener;
}
const restore = (el: HTMLElement | null) => (e: Event) => {
  e.preventDefault();
  if (el?.isConnected) el.focus();
};

export function CommandPalette({
  open,
  onOpenChange,
  onShowHelp,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShowHelp: () => void;
}) {
  const [path, navigate] = useLocation();
  const { resolvedTheme, toggleTheme } = useTheme();
  const prefs = useUiPrefs();
  const dispatch = useUiPrefsDispatch();
  const refresh = useRefreshAll();
  const isWide = useMediaQuery(MD_QUERY);
  const logs = useHostLogs(open);
  const { pins, isStale } = useLogPins();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const opener = useOpener(open);
  const listId = useId();
  const optionRefs = useRef(new Map<string, HTMLElement>());
  const host = useHost();
  const hosts = useHosts();

  const actions = useMemo(
    () =>
      buildActions({
        navigate, path, canEdit: path.endsWith("/dashboard") && isWide, editing: prefs.editing,
        setEditing: (editing) => dispatch({ type: "setEditing", editing }),
        resolvedTheme, toggleTheme, density: prefs.density,
        setDensity: (density) => dispatch({ type: "setDensity", density }),
        paused: prefs.paused, setPaused: (paused) => dispatch({ type: "setPaused", paused }),
        refresh: () => void refresh(),
        logs: logs.data ?? [], pins: pins.map((p) => ({ ...p, stale: isStale(p.logId) })),
        requestUpdate: () => setConfirmUpdate(true), showHelp: onShowHelp,
        hostId: host.id, hosts: hosts.data ?? [],
      }),
    [navigate, path, isWide, prefs.editing, prefs.density, prefs.paused, dispatch, resolvedTheme, toggleTheme, refresh, logs.data, pins, isStale, onShowHelp, host.id, hosts.data],
  );

  const results = useMemo(() => {
    const matched = fuzzyFilter(actions, query, (a) => [a.label, ...(a.keywords ?? [])]);
    // With no query, keep the list short: every command, pins, the 8 newest logs.
    const trimmed = query.trim() ? matched : matched.filter((a, i, all) => a.group !== "Logs" || all.slice(0, i).filter((b) => b.group === "Logs").length < 8);
    return trimmed.slice(0, MAX_RESULTS);
  }, [actions, query]);

  useEffect(() => setActive(0), [query, open]);
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  const current = results[Math.min(active, results.length - 1)];
  useEffect(() => {
    if (current) optionRefs.current.get(current.id)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const run = (a: PaletteAction | undefined) => {
    if (!a) return;
    onOpenChange(false);
    a.perform();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!results.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(current);
    }
  };

  // Group headers in result order.
  const grouped: { group: string; items: PaletteAction[] }[] = [];
  for (const a of results) {
    const last = grouped[grouped.length - 1];
    if (last?.group === a.group) last.items.push(a);
    else grouped.push({ group: a.group, items: [a] });
  }
  const optionId = (a: PaletteAction) => `${listId}-${a.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className={SCRIM} />
          <DialogPrimitive.Content className={panel} aria-describedby={undefined} data-testid="command-palette"
            onCloseAutoFocus={confirmUpdate ? (e) => e.preventDefault() : restore(opener.current)}>
            <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
            <div className="flex items-center gap-2 border-b border-pi-border px-3">
              <Search className="h-4 w-4 shrink-0 text-pi-text-muted" aria-hidden />
              <input
                autoFocus
                role="combobox"
                aria-label="Type a command or search"
                aria-expanded="true"
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={current ? optionId(current) : undefined}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Type a command, tab or log name…"
                className="h-12 w-full bg-transparent text-sm text-pi-text outline-none placeholder:text-pi-text-muted"
              />
            </div>
            <div role="listbox" id={listId} aria-label="Commands" className="custom-scrollbar max-h-[min(60vh,26rem)] overflow-y-auto p-1">
              {results.length === 0 && <p className="px-3 py-6 text-center text-sm text-pi-text-muted">No matching commands</p>}
              {grouped.map(({ group, items }) => (
                <div role="group" key={group} aria-labelledby={`${listId}-g-${group.replace(/\W/g, "")}`}>
                  <div role="presentation" id={`${listId}-g-${group.replace(/\W/g, "")}`} className="px-2 pb-1 pt-2 text-xs font-semibold text-pi-text-muted">
                    {group}
                  </div>
                  {items.map((a) => {
                    const selected = a === current;
                    return (
                      <div
                        key={a.id}
                        id={optionId(a)}
                        role="option"
                        aria-selected={selected}
                        ref={(el) => { if (el) optionRefs.current.set(a.id, el); else optionRefs.current.delete(a.id); }}
                        onMouseMove={() => setActive(results.indexOf(a))}
                        onClick={() => run(a)}
                        className={cn(
                          "flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm",
                          selected ? "bg-pi-accent text-pi-on-accent" : a.muted ? "text-pi-text-muted" : "text-pi-text",
                        )}
                      >
                        <span className={cn("truncate", a.muted && "line-through decoration-1")}>{a.label}</span>
                        {a.hint && <span className={cn("shrink-0 text-xs", selected ? "text-pi-on-accent" : "text-pi-text-muted")}>{a.hint}</span>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <p className="border-t border-pi-border px-3 py-1.5 text-xs text-pi-text-muted">↑↓ to move · Enter to run · Esc to close</p>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      <UpdateSystemConfirm open={confirmUpdate} onOpenChange={setConfirmUpdate} returnFocusRef={opener} />
    </>
  );
}

const GROUPS: Shortcut["group"][] = ["General", "Go to", "Dashboard"];

/** "?" sheet, rendered straight from SHORTCUTS so it can't drift from the handler. */
export function ShortcutHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const opener = useOpener(open);
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={SCRIM} />
        <DialogPrimitive.Content className={cn(panel, "p-5")} data-testid="shortcut-help" onCloseAutoFocus={restore(opener.current)}>
          <DialogPrimitive.Title className="text-lg font-semibold">Keyboard shortcuts</DialogPrimitive.Title>
          <DialogPrimitive.Description className="mb-3 text-sm text-pi-text-muted">
            Single keys work when you're not typing in a field. Nothing destructive has a shortcut.
          </DialogPrimitive.Description>
          <div className="space-y-4">
            {GROUPS.map((g) => (
              <table key={g} className="w-full text-sm">
                <caption className="pb-1 text-left text-xs font-semibold text-pi-text-muted">{g}</caption>
                <tbody>
                  {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                    <tr key={s.id} className="border-t border-pi-border">
                      <td className="py-1.5 pr-4">{s.label}</td>
                      <td className="whitespace-nowrap py-1.5 text-right">
                        {s.keys.map((k, i) => (
                          <Fragment key={i}>
                            {i > 0 && <span className="px-1 text-xs text-pi-text-muted">{s.keys[0] === "Mod" ? "+" : "then"}</span>}
                            <kbd className="rounded border border-pi-border bg-pi-darker px-1.5 py-0.5 font-mono text-xs">{keyLabel(k, mac)}</kbd>
                          </Fragment>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
          <DialogPrimitive.Close className="mt-4 inline-flex h-9 items-center rounded-md border border-pi-border px-4 text-sm hover:bg-pi-card-hover">
            Close
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
