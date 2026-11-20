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

function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Theme preference is a per-browser convenience only; it is not application data. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme() ?? systemTheme());

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* storage unavailable — theme still applies for this session */
      }
      return next;
    });
  }, []);

  return [theme, toggle];
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
