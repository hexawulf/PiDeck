import { createContext, useContext } from "react";
import type { Speed } from "./prefs";

// Just what polling needs, split out of UiPrefsProvider so a layout change
// doesn't re-render every widget query, and so useRefetch doesn't import the
// widget registry (registry → widgets → useRefetch would be a cycle).
export type RefreshPrefs = { speed: Speed; paused: boolean };
export const RefreshCtx = createContext<RefreshPrefs>({ speed: "live", paused: false });
export const useRefreshPrefs = () => useContext(RefreshCtx);
