import { createContext, useContext } from "react";

export interface ViewModeValue {
  /** Leaves view-only mode and returns to the sign-in page. */
  exit: () => void;
}

/** Provided only while someone is browsing in view-only mode (no GitHub sign-in). */
export const ViewModeContext = createContext<ViewModeValue | null>(null);

export function useViewMode(): ViewModeValue | null {
  return useContext(ViewModeContext);
}

const VIEW_KEY = "dim-view-only";

/** Opening the site with "?view" (the link shared with management) or a remembered choice. */
export function wantsViewMode(): boolean {
  try {
    if (new URLSearchParams(window.location.search).has("view")) return true;
    return sessionStorage.getItem(VIEW_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberViewMode(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(VIEW_KEY, "1");
    else sessionStorage.removeItem(VIEW_KEY);
  } catch {
    /* storage unavailable — the choice lasts until the page is closed */
  }
  if (!on && new URLSearchParams(window.location.search).has("view")) {
    const url = new URL(window.location.href);
    url.searchParams.delete("view");
    window.history.replaceState(null, "", url.toString());
  }
}
