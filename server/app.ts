import { existsSync } from "node:fs";
import path from "node:path";
import express, { type Express } from "express";
import type { ServerConfig } from "./config";
import { createTokenProvider } from "./github/auth";
import { basicAuth, errorHandler, noStore, securityHeaders } from "./middleware";
import { devicesRouter } from "./routes/devices";
import { DeviceService } from "../shared/deviceService";
import { GitHubFileStore } from "../shared/githubStore";
import { LocalFileStore } from "./storage/localStore";
import type { DeviceFileStore } from "../shared/storeTypes";

export function createStore(config: ServerConfig, fetchFn: typeof fetch = fetch): DeviceFileStore {
  if (config.storage === "local") return new LocalFileStore(config.local!.filePath);
  const gh = config.github!;
  return new GitHubFileStore({
    owner: gh.owner,
    repo: gh.repo,
    branch: gh.branch,
    filePath: gh.filePath,
    apiUrl: gh.apiUrl,
    tokens: createTokenProvider(gh.auth, gh.apiUrl, fetchFn),
    committer: gh.committerName && gh.committerEmail ? { name: gh.committerName, email: gh.committerEmail } : undefined,
    fetchFn,
    readOnly: gh.auth.kind === "none",
  });
}

export interface AppOptions {
  store: DeviceFileStore;
  basicAuth?: { user: string; password: string };
  staticDir?: string;
}

export function createApp({ store, basicAuth: credentials, staticDir }: AppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(securityHeaders);
  if (credentials) app.use(basicAuth(credentials));

  const service = new DeviceService(store);
  app.use("/api", noStore, express.json({ limit: "5mb" }), devicesRouter(service, store, Boolean(credentials)));

  // Production: serve the built frontend and fall back to index.html for client-side routes.
  if (staticDir && existsSync(path.join(staticDir, "index.html"))) {
    app.use(express.static(staticDir, { index: false, maxAge: "1h" }));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) return next();
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(staticDir, "index.html"));
    });
  }

  app.use(errorHandler);
  return app;
}
