import path from "node:path";
import { createApp, createStore } from "./app";
import { loadDotEnv, readConfig } from "./config";

loadDotEnv();

let config;
try {
  config = readConfig();
} catch (error) {
  console.error(`\n${(error as Error).message}\n`);
  process.exit(1);
}

const store = createStore(config);
const staticDir = config.staticDir ?? path.resolve("dist");
const app = createApp({ store, basicAuth: config.basicAuth, staticDir });

app.listen(config.port, () => {
  console.log(`Device Information Manager API listening on http://localhost:${config.port}`);
  console.log(`Data source: ${store.location}`);
  if (store.readOnly) console.warn("No GitHub credentials configured — READ-ONLY mode: data can be viewed but not saved.");
  if (store.kind === "local") console.warn("STORAGE_MODE=local — changes are written to disk only, NOT committed to GitHub.");
});
