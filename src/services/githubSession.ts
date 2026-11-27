import { AppError } from "../../shared/errors";
import { DeviceService } from "../../shared/deviceService";
import { GitHubFileStore } from "../../shared/githubStore";
import type { AppConfigInfo } from "../../shared/types";
import { GITHUB_API_URL, type GitHubTarget } from "../config";
import { ApiError, type Api } from "./api";
import { refreshGitHubToken, type TokenSet } from "./githubOAuth";

/**
 * Browser-only ("github-direct") mode.
 *
 * Each user signs in with THEIR OWN fine-grained GitHub token. The token never
 * leaves the user's browser except in requests to api.github.com, and GitHub
 * itself decides what the user may do: only collaborators with write access to
 * the repository can commit. No shared secret exists anywhere in the site.
 */
export interface GitHubSession {
  token: string;
  login: string;
  name?: string;
  avatarUrl?: string;
  canWrite: boolean;
  /** "Sign in with GitHub" sessions can renew themselves; personal tokens cannot. */
  refreshToken?: string;
  expiresAt?: number;
  remember?: boolean;
  /** Set when signed in on the Moderator card: the name typed there, recorded on every change. */
  moderator?: string;
}

const TOKEN_KEY = "dim-github-token";

function storages(): Storage[] {
  const list: Storage[] = [];
  try {
    list.push(sessionStorage);
  } catch {
    /* unavailable */
  }
  try {
    list.push(localStorage);
  } catch {
    /* unavailable */
  }
  return list;
}

/** Stored credentials. Kept for this tab only unless the user ticks "Remember me on this device". */
export type StoredCredentials = TokenSet & { remember: boolean; moderator?: string };

export function storeCredentials(credentials: StoredCredentials): void {
  clearStoredToken();
  try {
    (credentials.remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, JSON.stringify(credentials));
  } catch {
    /* storage blocked: the session still works until the tab is closed */
  }
}

/** Personal-access-token sign-in (no expiry, no refresh). */
export function storeToken(token: string, remember: boolean, moderator?: string): void {
  storeCredentials({ accessToken: token, remember, moderator });
}

export function readStoredCredentials(): StoredCredentials | null {
  for (const storage of storages()) {
    try {
      const value = storage.getItem(TOKEN_KEY);
      if (!value) continue;
      const parsed = JSON.parse(value) as StoredCredentials;
      if (typeof parsed.accessToken === "string" && parsed.accessToken) return parsed;
    } catch {
      /* ignore malformed entries */
    }
  }
  return null;
}

export function readStoredToken(): string | null {
  return readStoredCredentials()?.accessToken ?? null;
}

export function clearStoredToken(): void {
  for (const storage of storages()) {
    try {
      storage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  }
}

/** Renews an expiring "Sign in with GitHub" token (one minute early). Returns the session unchanged otherwise. */
export async function ensureFreshSession(session: GitHubSession, refresh = refreshGitHubToken): Promise<GitHubSession> {
  if (!session.expiresAt || !session.refreshToken || Date.now() < session.expiresAt - 60_000) return session;
  const tokens = await refresh(session.refreshToken);
  session.token = tokens.accessToken;
  session.refreshToken = tokens.refreshToken ?? session.refreshToken;
  session.expiresAt = tokens.expiresAt;
  storeCredentials({ ...tokens, refreshToken: session.refreshToken, remember: Boolean(session.remember), moderator: session.moderator });
  return session;
}

/** Signs in from stored or freshly issued credentials (refreshing first if they have expired). */
export async function signInWithCredentials(credentials: StoredCredentials, target: GitHubTarget, fetchFn: typeof fetch = fetch): Promise<GitHubSession> {
  let current: TokenSet = credentials;
  if (current.expiresAt && current.refreshToken && Date.now() >= current.expiresAt - 60_000) {
    current = { ...(await refreshGitHubToken(current.refreshToken)), remember: credentials.remember } as StoredCredentials;
  }
  const session = await signInWithToken(current.accessToken, target, fetchFn);
  const full: GitHubSession = { ...session, refreshToken: current.refreshToken, expiresAt: current.expiresAt, remember: credentials.remember, moderator: credentials.moderator };
  storeCredentials({ accessToken: full.token, refreshToken: full.refreshToken, expiresAt: full.expiresAt, remember: credentials.remember, moderator: full.moderator });
  return full;
}

/** "Priya (moderator)" for moderator sign-ins; undefined for team members. */
export function moderatorActor(session: GitHubSession): string | undefined {
  return session.moderator ? `${session.moderator} (moderator)` : undefined;
}

export class SignInError extends Error {}

/** Checks the token with GitHub and finds out whether this user may write to the target repo. */
export async function signInWithToken(token: string, target: GitHubTarget, fetchFn: typeof fetch = fetch): Promise<GitHubSession> {
  const trimmed = token.trim();
  if (!trimmed) throw new SignInError("Paste your GitHub token.");
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${trimmed}`, "X-GitHub-Api-Version": "2022-11-28" };

  let userRes: Response;
  try {
    userRes = await fetchFn(`${GITHUB_API_URL}/user`, { headers });
  } catch {
    throw new SignInError("GitHub could not be reached. Check your network connection.");
  }
  if (userRes.status === 401) throw new SignInError("GitHub rejected this token. It may be mistyped, expired or revoked.");
  if (!userRes.ok) throw new SignInError(`GitHub returned an error (${userRes.status}). Try again in a moment.`);
  const user = (await userRes.json()) as { login: string; name?: string | null; avatar_url?: string };

  const repoRes = await fetchFn(`${GITHUB_API_URL}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`, { headers });
  if (repoRes.status === 404) {
    throw new SignInError(`This token cannot see ${target.owner}/${target.repo}. Make sure it includes that repository.`);
  }
  if (!repoRes.ok) throw new SignInError(`Could not check access to ${target.owner}/${target.repo} (${repoRes.status}).`);
  const repo = (await repoRes.json()) as { permissions?: { push?: boolean } };

  return {
    token: trimmed,
    login: user.login,
    name: user.name ?? undefined,
    avatarUrl: user.avatar_url,
    canWrite: Boolean(repo.permissions?.push),
  };
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof AppError) return new ApiError(error.status, error.code, error.message, error.details);
  return new ApiError(0, "NETWORK", "GitHub could not be reached. Check your network connection.");
}

/**
 * Same Api surface as the server client, but every call goes straight to GitHub
 * using the shared DeviceService: fetch latest + SHA → record-level merge with
 * conflict detection → validate → commit with SHA → retry on a stale SHA.
 */
export function createDirectClient(target: GitHubTarget, session: GitHubSession, fetchFn: typeof fetch = (...a) => fetch(...a)): Api {
  const store = new GitHubFileStore({
    ...target,
    apiUrl: GITHUB_API_URL,
    tokens: { getToken: async () => (await ensureFreshSession(session)).token },
    fetchFn,
    readOnly: !session.canWrite,
  });
  const service = new DeviceService(store);
  const actor = moderatorActor(session);
  const run = async <T,>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      throw toApiError(error);
    }
  };

  return {
    getConfig: async (): Promise<AppConfigInfo> => ({
      storage: "github",
      location: store.location,
      repoUrl: store.repoUrl,
      authEnabled: true,
      readOnly: store.readOnly,
      user: session.login,
      moderator: session.moderator,
    }),
    getDevices: () => run(() => service.getSnapshot()),
    initialize: () => run(() => service.initialize()),
    // Team commits are authored by the signed-in user. Moderator commits add "Requested by: <name> (moderator)".
    createRecord: (key, values) => run(() => service.createRecord(key, values, actor)),
    updateRecord: (key, base, values) => run(() => service.updateRecord(key, base, values, actor)),
    deleteRecord: (key, base) => run(() => service.deleteRecord(key, base, actor)),
    importRecords: (mode, mutations) => run(() => service.importRecords(mode, mutations, actor)),
  };
}
