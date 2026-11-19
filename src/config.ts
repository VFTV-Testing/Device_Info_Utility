/**
 * Build-time configuration (Vite). These values are PUBLIC — never put secrets in VITE_* variables.
 *
 *  VITE_DATA_MODE=server         (default) the browser talks to this app's Node server (/api)
 *  VITE_DATA_MODE=github-direct  static site (e.g. GitHub Pages): each user signs in with their
 *                                own GitHub token and the browser commits directly to GitHub.
 */
export type DataMode = "server" | "github-direct";

export const DATA_MODE: DataMode = import.meta.env.VITE_DATA_MODE === "github-direct" ? "github-direct" : "server";

export interface GitHubTarget {
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
}

export const GITHUB_TARGET: GitHubTarget = {
  owner: import.meta.env.VITE_GITHUB_OWNER ?? "",
  repo: import.meta.env.VITE_GITHUB_REPO ?? "",
  branch: import.meta.env.VITE_GITHUB_BRANCH || "main",
  filePath: (import.meta.env.VITE_GITHUB_FILE_PATH || "deviceInformation.json").replace(/^\/+/, ""),
};

export const GITHUB_API_URL = "https://api.github.com";

/**
 * "Sign in with GitHub" (optional). Both values are public:
 *  - VITE_OAUTH_CLIENT_ID: the GitHub App's Client ID
 *  - VITE_AUTH_HELPER_URL: where the token-exchange helper runs (auth-helper/)
 * When unset, users sign in with a personal access token instead.
 */
export const OAUTH_CLIENT_ID = import.meta.env.VITE_OAUTH_CLIENT_ID ?? "";
export const AUTH_HELPER_URL = (import.meta.env.VITE_AUTH_HELPER_URL ?? "").replace(/\/+$/, "");
export const OAUTH_ENABLED = Boolean(OAUTH_CLIENT_ID && AUTH_HELPER_URL);
