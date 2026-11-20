import "@testing-library/jest-dom/vitest";

// Browser APIs that jsdom lacks but Radix UI / cmdk / framer-motion use.
if (typeof window !== "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function () {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// Filters, views and the view-only choice are remembered in browser storage; start every test clean.
import { afterEach } from "vitest";
afterEach(() => {
  if (typeof sessionStorage !== "undefined") sessionStorage.clear();
  if (typeof localStorage !== "undefined") localStorage.clear();
});

// UI tests render the whole app (animations included); under a full parallel run the first
// render can take just over the default 1 s, so give async queries a little more room.
import { configure } from "@testing-library/react";
configure({ asyncUtilTimeout: 3000 });
