import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type Dispatch, type ReactNode } from "react";
import { toast } from "@/hooks/use-toast";
import { RefreshCtx } from "./refresh-context";
import { WIDGETS } from "@/widgets/registry";
import {
  browserStore, defaultLayout, defaultPrefs, loadPrefs, PREFS_KEY, savePrefs, serializePrefs,
  type Density, type LayoutItem, type LoadIssue, type PersistedPrefs, type SectionName, type Speed, type Store,
} from "./prefs";

// UI prefs (E2): one reducer, separate state and dispatch contexts so
// components that only dispatch don't re-render. `paused` is session-only.

export type UiPrefsState = PersistedPrefs & { paused: boolean };

export type UiPrefsAction =
  | { type: "setLayout"; layout: LayoutItem[] }
  | { type: "hide"; id: string }
  | { type: "show"; id: string }
  | { type: "resetLayout" }
  | { type: "setDensity"; density: Density }
  | { type: "setSpeed"; speed: Speed }
  | { type: "setPaused"; paused: boolean }
  | { type: "replace"; prefs: PersistedPrefs } // import, reset-all, another tab
  ;

export function uiPrefsReducer(state: UiPrefsState, action: UiPrefsAction): UiPrefsState {
  switch (action.type) {
    case "setLayout":
      return { ...state, layout: action.layout };
    case "hide":
      return state.hidden.includes(action.id) ? state : { ...state, hidden: [...state.hidden, action.id] };
    case "show":
      return { ...state, hidden: state.hidden.filter((id) => id !== action.id) };
    case "resetLayout":
      return { ...state, layout: defaultLayout(WIDGETS), hidden: [] };
    case "setDensity":
      return { ...state, density: action.density };
    case "setSpeed":
      return { ...state, speed: action.speed };
    case "setPaused":
      return { ...state, paused: action.paused };
    case "replace":
      return { ...action.prefs, paused: state.paused };
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
};

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
  const [state, dispatch] = useReducer(uiPrefsReducer, undefined, () => ({ ...initial.current!.prefs, paused: false }));

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
  const { layout, hidden, density, speed, pins } = state;
  const lastSaved = useRef(serializePrefs(initial.current.prefs));
  const quotaWarned = useRef(false);
  useEffect(() => {
    const prefs = { layout, hidden, density, speed, pins };
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
  }, [store, layout, hidden, density, speed, pins]);

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

  const refresh = useMemo(() => ({ speed: state.speed, paused: state.paused }), [state.speed, state.paused]);
  return (
    <DispatchCtx.Provider value={dispatch}>
      <StateCtx.Provider value={state}>
        <RefreshCtx.Provider value={refresh}>{children}</RefreshCtx.Provider>
      </StateCtx.Provider>
    </DispatchCtx.Provider>
  );
}
