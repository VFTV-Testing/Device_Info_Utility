import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";
import { App } from "./App";
import "./styles/index.css";
import "./styles/cards.css";
import { reloadOnceForUpdate } from "./lib/staleBuild";

// A file the page needs is gone because the site was updated while this tab was open.
window.addEventListener("vite:preloadError", (event) => {
  if (reloadOnceForUpdate()) event.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
