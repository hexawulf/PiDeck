import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useLocation } from "wouter";
import { useTheme } from "@/components/theme-provider";
import { MD_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { useRefreshAll } from "@/hooks/use-refresh-all";
import { useUiPrefs, useUiPrefsDispatch } from "@/prefs/UiPrefsProvider";
import { isDialogOpen, isTypingTarget, resolveKey, SEQUENCE_TIMEOUT_MS, type ShortcutId } from "@/shortcuts/shortcuts";
import { useHost, useHostSummary } from "@/hosts/HostProvider";
import { hostHref } from "@/hosts/host-path";
import { OPEN_HOST_SWITCHER } from "@/components/host-switcher";

// Main-chunk side of the palette (E23): this trigger, the key handler and the
// shortcut table. The palette UI and the help sheet load on first use.
const CommandPalette = lazy(() => import("@/palette/CommandPalette").then((m) => ({ default: m.CommandPalette })));
const ShortcutHelp = lazy(() => import("@/palette/CommandPalette").then((m) => ({ default: m.ShortcutHelp })));

export function useCommandCenter() {
  const [path, navigate] = useLocation();
  const { toggleTheme } = useTheme();
  const { paused, editing } = useUiPrefs();
  const dispatch = useUiPrefsDispatch();
  const refreshAll = useRefreshAll();
  const isWide = useMediaQuery(MD_QUERY);
  const host = useHost();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [loaded, setLoaded] = useState({ palette: false, help: false }); // mount once, then keep

  const openPalette = useCallback(() => {
    setLoaded((l) => (l.palette ? l : { ...l, palette: true }));
    setPaletteOpen(true);
  }, []);
  const openHelp = useCallback(() => {
    setLoaded((l) => (l.help ? l : { ...l, help: true }));
    setHelpOpen(true);
  }, []);

  // Latest state for the handler without re-binding the listener.
  const hostLogs = useHostSummary(host.id)?.logs === true && !host.isLocal;
  const latest = useRef({ path, paused, editing, isWide, hostId: host.id, hostLogs });
  latest.current = { path, paused, editing, isWide, hostId: host.id, hostLogs };

  const run = useCallback(
    (id: ShortcutId) => {
      const s = latest.current;
      switch (id) {
        case "palette": return openPalette(); // resolveKey ignores it while a dialog (incl. the palette) is open
        case "help": return openHelp();
        case "theme": return toggleTheme();
        // Dashboard and Apps stay on the current host; Logs, Cron and Settings are the hub's.
        case "go-dashboard": return navigate(hostHref(s.hostId, "dashboard"));
        case "go-logs": return navigate(s.hostLogs ? hostHref(s.hostId, "logs") : "/logs"); // a remote host's own logs when it has them
        case "go-apps": return navigate(hostHref(s.hostId, "apps"));
        case "go-cron": return navigate("/cron");
        case "go-settings": return navigate("/settings");
        case "go-hosts": return void window.dispatchEvent(new Event(OPEN_HOST_SWITCHER)); // no-op without remote hosts
        case "go-overview": return navigate("/hosts");
        case "edit":
          if (s.path.endsWith("/dashboard") && s.isWide) dispatch({ type: "setEditing", editing: !s.editing });
          return;
        case "pause": return dispatch({ type: "setPaused", paused: !s.paused });
        case "refresh": return void refreshAll();
      }
    },
    [openPalette, openHelp, toggleTheme, navigate, dispatch, refreshAll],
  );

  const pending = useRef<{ key: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const prev = pending.current?.key ?? null;
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current = null;
      const r = resolveKey(e, prev, { typing: isTypingTarget(e.target), dialogOpen: isDialogOpen() });
      if (r.pending) pending.current = { key: r.pending, timer: setTimeout(() => (pending.current = null), SEQUENCE_TIMEOUT_MS) };
      if (r.action) {
        e.preventDefault();
        run(r.action);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run]);

  const dialogs = (
    <Suspense fallback={null}>
      {loaded.palette && <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onShowHelp={openHelp} />}
      {loaded.help && <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} />}
    </Suspense>
  );

  return { openPalette, dialogs };
}

/** Header button: the pointer/touch way into the palette (works at 390px). */
export function PaletteButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open command palette"
      aria-keyshortcuts="Control+K Meta+K"
      title="Command palette (Ctrl/⌘+K)"
      data-testid="palette-button"
      className="inline-flex h-9 items-center gap-2 rounded-md border border-pi-border px-2 text-pi-text hover:bg-pi-card-hover"
    >
      <Search className="h-5 w-5" aria-hidden />
      <kbd className="hidden rounded border border-pi-border px-1 font-mono text-xs text-pi-text-muted xl:inline">Ctrl K</kbd>
    </button>
  );
}
