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

// Filters and the view-only choice are remembered per tab (sessionStorage); start every test clean.
import { afterEach } from "vitest";
afterEach(() => {
  if (typeof sessionStorage !== "undefined") sessionStorage.clear();
});
