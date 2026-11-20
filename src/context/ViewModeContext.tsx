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

/**
 * Opening the site with "?view" (the link shared with management) or a remembered choice.
 * Tolerant on purpose: "?view=1", "?View" or "?view**" pasted from chat all count.
 */
export function hasViewParam(search: string): boolean {
  return /[?&]view\b/i.test(search);
}

export function wantsViewMode(): boolean {
  try {
    if (hasViewParam(window.location.search)) return true;
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
  if (!on && hasViewParam(window.location.search)) {
    // Drop the view parameter so "Sign in to edit" does not bounce straight back into view mode.
    const url = new URL(window.location.href);
    url.search = "";
    window.history.replaceState(null, "", url.toString());
  }
}
