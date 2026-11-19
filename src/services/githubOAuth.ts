import { AUTH_HELPER_URL, OAUTH_CLIENT_ID } from "../config";

/**
 * "Sign in with GitHub" — GitHub App user authorization (web flow).
 *   1. startGitHubLogin(): redirect to github.com with a random `state`.
 *   2. GitHub redirects back to this page with ?code=…&state=….
 *   3. completeGitHubLogin(): verify `state`, send the code to the helper, receive a user token.
 * Tokens from a GitHub App expire after 8 hours and are renewed with the refresh token.
 */
export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when the access token expires (undefined = no expiry). */
  expiresAt?: number;
}

const STATE_KEY = "dim-oauth-state";

export class OAuthError extends Error {}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The page URL GitHub sends the user back to (no query string or hash). */
export function redirectUri(loc: Location = window.location): string {
  return loc.origin + loc.pathname;
}

export function buildAuthorizeUrl(state: string, redirect: string, clientId = OAUTH_CLIENT_ID): string {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, state, allow_signup: "false" });
  return `https://github.com/login/oauth/authorize?${params}`;
}

export function startGitHubLogin(remember: boolean): void {
  const state = randomState();
  try {
    sessionStorage.setItem(STATE_KEY, JSON.stringify({ state, remember }));
  } catch {
    throw new OAuthError("Your browser blocked session storage, which sign-in needs. Allow site data and try again.");
  }
  window.location.assign(buildAuthorizeUrl(state, redirectUri()));
}

function toTokenSet(body: Record<string, unknown>): TokenSet {
  if (typeof body.access_token !== "string") throw new OAuthError("GitHub did not return a token.");
  const expiresIn = Number(body.expires_in);
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : undefined,
    expiresAt: expiresIn > 0 ? Date.now() + expiresIn * 1000 : undefined,
  };
}

async function callHelper(path: "token" | "refresh", payload: Record<string, string>, fetchFn: typeof fetch): Promise<TokenSet> {
  let response: Response;
  try {
    response = await fetchFn(`${AUTH_HELPER_URL}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new OAuthError("The sign-in helper could not be reached. Check your connection or try again later.");
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const reason = typeof body.error_description === "string" ? body.error_description : "Sign-in failed.";
    throw new OAuthError(body.error === "bad_verification_code" ? "The sign-in link expired. Please sign in again." : reason);
  }
  return toTokenSet(body);
}

/**
 * If this page load is GitHub's redirect back, finishes sign-in and cleans the URL.
 * Returns null when there is no pending sign-in.
 */
export async function completeGitHubLogin(fetchFn: typeof fetch = (...a) => fetch(...a)): Promise<(TokenSet & { remember: boolean }) | null> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const denied = params.get("error");
  if (!code && !denied) return null;

  // Remove ?code=… from the address bar and history straight away.
  window.history.replaceState(null, "", redirectUri() + window.location.hash);

  let pending: { state?: string; remember?: boolean } = {};
  try {
    pending = JSON.parse(sessionStorage.getItem(STATE_KEY) ?? "{}");
    sessionStorage.removeItem(STATE_KEY);
  } catch {
    /* ignore */
  }
  if (denied) throw new OAuthError("Sign-in was cancelled on GitHub.");
  if (!state || !pending.state || state !== pending.state) {
    throw new OAuthError("Sign-in could not be verified (state mismatch). Please try again.");
  }
  const tokens = await callHelper("token", { code: code! }, fetchFn);
  return { ...tokens, remember: Boolean(pending.remember) };
}

export function refreshGitHubToken(refreshToken: string, fetchFn: typeof fetch = (...a) => fetch(...a)): Promise<TokenSet> {
  return callHelper("refresh", { refresh_token: refreshToken }, fetchFn);
}
