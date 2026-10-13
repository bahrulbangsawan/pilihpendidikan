import { useCallback, useSyncExternalStore } from "react";

/** Phones (< 640px) get the stage switcher instead of columns (12 §3). */
export const PHONE_QUERY = "(max-width: 639px)";
/** ≥ 1280px keeps the board visible beside an application (12 §3). */
export const WIDE_QUERY = "(min-width: 1280px)";

/** A CSS media query as React state; false during SSR. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query]
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  );
}
