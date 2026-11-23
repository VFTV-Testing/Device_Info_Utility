import { useCallback, useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export type Theme = "light" | "dark";
const THEME_KEY = "dim-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function storeTheme(value: Theme | null): void {
  try {
    if (value) localStorage.setItem(THEME_KEY, value);
    else localStorage.removeItem(THEME_KEY);
  } catch {
    /* storage unavailable — theme still applies for this session */
  }
}

function systemTheme(): Theme {
  try {
    return window.matchMedia?.(DARK_QUERY).matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

/**
 * Light / dark theme that follows the Windows or browser setting automatically.
 * Picking Light or Dark overrides it in this browser; the override is dropped when the
 * system setting changes, or when the pick matches the system again.
 */
export function useTheme(): [Theme, (next: Theme) => void] {
  const [override, setOverride] = useState<Theme | null>(readStoredTheme);
  const [system, setSystem] = useState<Theme>(systemTheme);

  useEffect(() => {
    let media: MediaQueryList | undefined;
    try {
      media = window.matchMedia?.(DARK_QUERY);
    } catch {
      return;
    }
    if (!media) return;
    const query = media;
    const onChange = () => {
      setSystem(query.matches ? "dark" : "light");
      setOverride(null); // the system setting just changed: follow it again
      storeTheme(null);
    };
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);

  const theme: Theme = override ?? system;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const setTheme = useCallback(
    (next: Theme) => {
      const value = next === system ? null : next;
      setOverride(value);
      storeTheme(value);
    },
    [system],
  );

  return [theme, setTheme];
}

/** Warns before closing/reloading the tab while there are unsaved edits. */
export function useBeforeUnload(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active]);
}

export const BACKGROUNDS = [
  { id: "dots", label: "Dot matrix", hint: "Glowing dot grid" },
  { id: "topo", label: "Topographic", hint: "Map contour lines" },
  { id: "waves", label: "Waves", hint: "Rolling waves at the bottom" },
  { id: "rain", label: "Data rain", hint: "Falling hex characters" },
] as const;
export type Background = (typeof BACKGROUNDS)[number]["id"];
const BACKGROUND_KEY = "dim-bg";
export const DEFAULT_BACKGROUND: Background = "rain";

function readStoredBackground(): Background {
  try {
    const value = localStorage.getItem(BACKGROUND_KEY);
    return BACKGROUNDS.some((b) => b.id === value) ? (value as Background) : DEFAULT_BACKGROUND;
  } catch {
    return DEFAULT_BACKGROUND;
  }
}

/** Page background style — a per-browser preference, like the theme. */
export function useBackground(): [Background, (next: Background) => void] {
  const [background, setBackgroundState] = useState<Background>(readStoredBackground);

  useEffect(() => {
    document.documentElement.dataset.bg = background;
  }, [background]);

  const setBackground = useCallback((next: Background) => {
    setBackgroundState(next);
    try {
      localStorage.setItem(BACKGROUND_KEY, next);
    } catch {
      /* storage unavailable — applies for this session only */
    }
  }, []);

  return [background, setBackground];
}
