import { useCallback, useSyncExternalStore } from "react";

/** Live `matchMedia` result; false where matchMedia is unavailable (tests). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => typeof window.matchMedia === "function" && window.matchMedia(query).matches);
}

/** Tailwind's `md`: the grid (and Edit mode) exist only at or above it. */
export const MD_QUERY = "(min-width: 768px)";
