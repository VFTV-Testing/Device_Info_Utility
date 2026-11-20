import type { EnvEntryInput, EnvWriteResult } from "../../shared/environment";
import { AUTH_HELPER_URL, type GitHubTarget } from "../config";
import { ApiError } from "./api";
import { createViewerEnvClient, type EnvApi } from "./environmentClient";

/**
 * Moderator sign-in: one shared key (given out by the tool owner) plus the person's name.
 * Moderators read like the view-only link and send Environment STATUS updates to the
 * sign-in helper, which checks the key and commits with the GitHub App.
 * The key is kept only in this browser (this tab, or this device with "Keep me signed in").
 */
export interface ModeratorSession {
  name: string;
  key: string;
  remember: boolean;
}

const STORAGE_KEY = "dim-moderator";
export const MODERATOR_ENABLED = Boolean(AUTH_HELPER_URL);

export function readModerator(): ModeratorSession | null {
  for (const storage of [sessionStorage, localStorage]) {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) continue;
      const value = JSON.parse(raw) as Partial<ModeratorSession>;
      if (typeof value.name === "string" && typeof value.key === "string") return { name: value.name, key: value.key, remember: Boolean(value.remember) };
    } catch {
      /* unreadable or blocked storage */
    }
  }
  return null;
}

export function storeModerator(session: ModeratorSession): void {
  try {
    (session.remember ? localStorage : sessionStorage).setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* storage unavailable — signed in for this page only */
  }
}

export function clearModerator(): void {
  for (const storage of [sessionStorage, localStorage]) {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

async function callHelper<T>(path: string, key: string, body: unknown, fetchFn: typeof fetch): Promise<T> {
  let response: Response;
  try {
    response = await fetchFn(`${AUTH_HELPER_URL}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "NETWORK", "The sign-in helper could not be reached. Check your network connection.");
  }
  const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof result.error_description === "string" ? result.error_description : `The helper refused the request (${response.status}).`;
    throw new ApiError(response.status, typeof result.error === "string" ? result.error.toUpperCase() : "HTTP_ERROR", message, result.details);
  }
  return result as T;
}

/** Checks the moderator key with the helper before signing in. */
export async function verifyModeratorKey(key: string, fetchFn: typeof fetch = (...a) => fetch(...a)): Promise<void> {
  await callHelper("moderator/verify", key.trim(), {}, fetchFn);
}

/** Reads like the view-only link; pushes status updates through the helper. */
export function createModeratorEnvClient(target: GitHubTarget, session: ModeratorSession, fetchFn: typeof fetch = (...a) => fetch(...a)): EnvApi {
  const reader = createViewerEnvClient(target);
  return {
    load: async () => ({ ...(await reader.load()), readOnly: false }),
    addEntries: (inputs: EnvEntryInput[]) =>
      callHelper<EnvWriteResult>("environment/entries", session.key, { name: session.name, entries: inputs }, fetchFn),
  };
}
