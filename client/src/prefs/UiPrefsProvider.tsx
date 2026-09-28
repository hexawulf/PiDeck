import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type Dispatch, type ReactNode } from "react";
import { toast } from "@/hooks/use-toast";
import { RefreshCtx } from "./refresh-context";
import { WIDGETS } from "@/widgets/registry";
import { useHost } from "@/hosts/HostProvider";
import {
  browserStore, defaultLayout, defaultPrefs, hostLayout, loadPrefs, PREFS_KEY, remoteRegistry, savePrefs, serializePrefs, withHostLayout,
  type Density, type HostLayout, type LayoutItem, type LoadIssue, type PersistedPrefs, type Pin, type SectionName, type Speed, type Store,
} from "./prefs";

// UI prefs (E2): one reducer, separate state and dispatch contexts so
// components that only dispatch don't re-render. Session-only (never saved):
// `paused`, `editing` (dashboard Edit mode, so the palette and the `e`
// shortcut can drive it) and `lastReset` (shown in About › Diagnostics).
//
// Multi-host: one layout per host. The state holds them all (`layout` /
// `hidden` = local, `layoutByHost` = remote hosts); what useUiPrefs() hands
// out is the *current host's* view, and useUiPrefsDispatch() tags layout
// actions with the current host — so the dashboard and the visibility list
// need no host logic of their own.

export type ResetRecord = { reason: string; at: string };
export type UiPrefsState = PersistedPrefs & { paused: boolean; editing: boolean; lastReset: ResetRecord | null };

export type UiPrefsAction =
  | { type: "setLayout"; layout: LayoutItem[]; host?: string }
  | { type: "hide"; id: string; host?: string }
  | { type: "show"; id: string; host?: string }
  | { type: "resetLayout"; host?: string }
  | { type: "setDensity"; density: Density }
  | { type: "setSpeed"; speed: Speed }
  | { type: "setPaused"; paused: boolean }
  | { type: "setEditing"; editing: boolean }
  | { type: "setPins"; pins: Pin[] }
  /** import, reset-all, another tab; `reason` marks it as a reset for Diagnostics */
  | { type: "replace"; prefs: PersistedPrefs; reason?: string }
  ;

const stamp = (reason: string): ResetRecord => ({ reason, at: new Date().toISOString() });

const LAYOUT_ACTIONS = new Set<UiPrefsAction["type"]>(["setLayout", "hide", "show", "resetLayout"]);

/** Apply a layout change to one host's layout, keeping the session-only fields. */
function onHost(state: UiPrefsState, host: string | undefined, change: (l: HostLayout) => Partial<HostLayout>): UiPrefsState {
  const h = host ?? "local";
  const current = hostLayout(state, h, WIDGETS);
  return { ...state, ...withHostLayout(state, h, change(current), WIDGETS) };
}

export function uiPrefsReducer(state: UiPrefsState, action: UiPrefsAction): UiPrefsState {
  switch (action.type) {
    case "setLayout":
      return onHost(state, action.host, () => ({ layout: action.layout }));
    case "hide":
      return hostLayout(state, action.host ?? "local", WIDGETS).hidden.includes(action.id)
        ? state
        : onHost(state, action.host, (l) => ({ hidden: [...l.hidden, action.id] }));
    case "show":
      return onHost(state, action.host, (l) => ({ hidden: l.hidden.filter((id) => id !== action.id) }));
    case "resetLayout": {
      const local = (action.host ?? "local") === "local";
      const layout = defaultLayout(local ? WIDGETS : remoteRegistry(WIDGETS));
      return { ...onHost(state, action.host, () => ({ layout, hidden: [] })), lastReset: stamp("Reset layout") };
    }
    case "setDensity":
      return { ...state, density: action.density };
    case "setSpeed":
      return { ...state, speed: action.speed };
    case "setPaused":
      return { ...state, paused: action.paused };
    case "setEditing":
      return state.editing === action.editing ? state : { ...state, editing: action.editing };
    case "setPins":
      return { ...state, pins: action.pins };
    case "replace":
      return {
        ...action.prefs,
        paused: state.paused,
        editing: state.editing,
        lastReset: action.reason ? stamp(action.reason) : state.lastReset,
      };
  }
}

const StateCtx = createContext<UiPrefsState | null>(null);
const DispatchCtx = createContext<Dispatch<UiPrefsAction>>(() => {});

export function useUiPrefs(): UiPrefsState {
  const s = useContext(StateCtx);
  if (!s) throw new Error("useUiPrefs needs <UiPrefsProvider>");
  return s;
}
export const useUiPrefsDispatch = () => useContext(DispatchCtx);

const SECTION_LABEL: Record<SectionName, string> = {
  layout: "layout", hidden: "hidden widgets", density: "density", speed: "refresh speed", pins: "log pins",
  layoutByHost: "per-host layouts",
};

/** Why loading fell back to defaults, in Diagnostics wording (null = it didn't). */
export function loadResetReason(issue: LoadIssue | null): string | null {
  if (!issue || issue.kind === "blocked") return null;
  if (issue.kind === "invalid") return "Saved prefs were invalid (all sections)";
  return `Saved ${issue.sections.map((s) => SECTION_LABEL[s]).join(", ")} invalid`;
}

function announce(issue: LoadIssue | null) {
  if (!issue) return;
  if (issue.kind === "blocked") {
    toast({ title: "Layout can't be saved in this browser", description: "Changes last until you close this tab." });
  } else if (issue.kind === "invalid") {
    toast({ title: "Saved layout was invalid – reset to default", variant: "destructive" });
  } else {
    const names = issue.sections.map((s) => SECTION_LABEL[s]).join(", ");
    toast({ title: `Saved ${names} settings were invalid – reset to default`, variant: "destructive" });
  }
}

export function UiPrefsProvider({ children, store = browserStore() }: { children: ReactNode; store?: Store | null }) {
  const initial = useRef<ReturnType<typeof loadPrefs>>();
  if (!initial.current) initial.current = loadPrefs(store, WIDGETS);
  const [state, dispatch] = useReducer(uiPrefsReducer, undefined, (): UiPrefsState => {
    const reason = loadResetReason(initial.current!.issue);
    return { ...initial.current!.prefs, paused: false, editing: false, lastReset: reason ? stamp(reason) : null };
  });

  // Toast load problems once (StrictMode runs effects twice in dev).
  const announced = useRef(false);
  const blocked = useRef(initial.current.issue?.kind === "blocked");
  useEffect(() => {
    if (announced.current) return;
    announced.current = true;
    announce(initial.current!.issue);
  }, []);

  // Persist on every change to a persisted section. Discrete events only —
  // the grid dispatches setLayout on drag/resize stop, never while dragging (E21).
  const { layout, hidden, density, speed, pins, layoutByHost } = state;
  const lastSaved = useRef(serializePrefs(initial.current.prefs));
  const quotaWarned = useRef(false);
  useEffect(() => {
    const prefs = { layout, hidden, density, speed, pins, layoutByHost };
    const text = serializePrefs(prefs);
    if (text === lastSaved.current || blocked.current) return;
    const result = savePrefs(store, prefs);
    if (result === "ok") {
      lastSaved.current = text;
      quotaWarned.current = false;
    } else if (result === "quota" && !quotaWarned.current) {
      quotaWarned.current = true;
      toast({ title: "Couldn't save layout", description: "Browser storage is full; changes last until you close this tab.", variant: "destructive" });
    } else if (result === "blocked") {
      blocked.current = true;
      announce({ kind: "blocked" });
    }
  }, [store, layout, hidden, density, speed, pins, layoutByHost]);

  // Another tab saved: adopt its prefs (no write-back, so no ping-pong).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== PREFS_KEY) return;
      const { prefs } = e.newValue === null ? { prefs: defaultPrefs(WIDGETS) } : loadPrefs(store, WIDGETS);
      lastSaved.current = serializePrefs(prefs);
      dispatch({ type: "replace", prefs });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [store]);

  // Dense mode (E13): tokens in index.css key off this attribute.
  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  // The current host's view: its layout/hidden in place of the local ones.
  const host = useHost();
  const view = useMemo<UiPrefsState>(
    () => (host.isLocal ? state : { ...state, ...hostLayout(state, host.id, WIDGETS) }),
    [state, host],
  );
  const hostDispatch = useCallback<Dispatch<UiPrefsAction>>(
    (action) => dispatch(LAYOUT_ACTIONS.has(action.type) && !("host" in action && action.host) ? ({ ...action, host: host.id } as UiPrefsAction) : action),
    [host.id],
  );

  const refresh = useMemo(() => ({ speed: state.speed, paused: state.paused }), [state.speed, state.paused]);
  return (
    <DispatchCtx.Provider value={hostDispatch}>
      <StateCtx.Provider value={view}>
        <RefreshCtx.Provider value={refresh}>{children}</RefreshCtx.Provider>
      </StateCtx.Provider>
    </DispatchCtx.Provider>
  );
}
