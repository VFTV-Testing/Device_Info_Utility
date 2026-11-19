import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type StorageMode = "github" | "local";

export type GitHubAuthConfig =
  | { kind: "token"; token: string }
  /** No credentials: anonymous read access (public repos only); every write is refused. */
  | { kind: "none" }
  | { kind: "app"; appId: string; installationId: string; privateKey: string };

export interface ServerConfig {
  port: number;
  storage: StorageMode;
  github?: {
    owner: string;
    repo: string;
    branch: string;
    filePath: string;
    apiUrl: string;
    auth: GitHubAuthConfig;
    committerName?: string;
    committerEmail?: string;
  };
  local?: { filePath: string };
  basicAuth?: { user: string; password: string };
  /** Directory with the built frontend (served in production). */
  staticDir?: string;
}

/** Loads `.env` from the working directory if present (Node ≥ 20.12 built-in, no dependency). */
export function loadDotEnv(cwd = process.cwd()): void {
  const file = path.join(cwd, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}

function required(env: NodeJS.ProcessEnv, name: string, problems: string[]): string {
  const value = env[name]?.trim();
  if (!value) problems.push(`${name} is required`);
  return value ?? "";
}

function readPrivateKey(env: NodeJS.ProcessEnv, problems: string[]): string {
  const inline = env.GITHUB_APP_PRIVATE_KEY?.trim();
  if (inline) return inline.replace(/\\n/g, "\n");
  const keyPath = env.GITHUB_APP_PRIVATE_KEY_PATH?.trim();
  if (keyPath) {
    try {
      return readFileSync(keyPath, "utf8");
    } catch {
      problems.push(`GITHUB_APP_PRIVATE_KEY_PATH could not be read`);
      return "";
    }
  }
  problems.push("GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH is required for GitHub App authentication");
  return "";
}

/**
 * Reads configuration from environment variables. All repository-specific values
 * come from the environment — nothing is hard-coded.
 */
export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const problems: string[] = [];
  const storage = (env.STORAGE_MODE?.trim().toLowerCase() || "github") as StorageMode;
  if (storage !== "github" && storage !== "local") {
    throw new Error(`STORAGE_MODE must be "github" or "local" (got "${env.STORAGE_MODE}")`);
  }

  const config: ServerConfig = {
    port: Number(env.PORT) || 3001,
    storage,
    staticDir: env.STATIC_DIR?.trim() || undefined,
  };

  if (storage === "github") {
    const owner = required(env, "GITHUB_OWNER", problems);
    const repo = required(env, "GITHUB_REPO", problems);
    let auth: GitHubAuthConfig | undefined;
    if (env.GITHUB_APP_ID?.trim()) {
      auth = {
        kind: "app",
        appId: env.GITHUB_APP_ID.trim(),
        installationId: required(env, "GITHUB_APP_INSTALLATION_ID", problems),
        privateKey: readPrivateKey(env, problems),
      };
    } else if (env.GITHUB_TOKEN?.trim()) {
      auth = { kind: "token", token: env.GITHUB_TOKEN.trim() };
    } else {
      auth = { kind: "none" };
    }
    config.github = {
      owner,
      repo,
      branch: env.GITHUB_BRANCH?.trim() || "main",
      filePath: (env.GITHUB_FILE_PATH?.trim() || "deviceInformation.json").replace(/^\/+/, ""),
      apiUrl: (env.GITHUB_API_URL?.trim() || "https://api.github.com").replace(/\/+$/, ""),
      auth: auth ?? { kind: "none" },
      committerName: env.GIT_COMMITTER_NAME?.trim() || undefined,
      committerEmail: env.GIT_COMMITTER_EMAIL?.trim() || undefined,
    };
  } else {
    config.local = { filePath: path.resolve(env.LOCAL_DATA_FILE?.trim() || "deviceInformation.json") };
  }

  const user = env.APP_BASIC_AUTH_USER?.trim();
  const password = env.APP_BASIC_AUTH_PASSWORD;
  if (user || password) {
    if (!user || !password) problems.push("Set both APP_BASIC_AUTH_USER and APP_BASIC_AUTH_PASSWORD, or neither");
    else config.basicAuth = { user, password };
  }

  if (problems.length) {
    throw new Error(`Invalid server configuration:\n  - ${problems.join("\n  - ")}\nSee .env.example.`);
  }
  return config;
}
