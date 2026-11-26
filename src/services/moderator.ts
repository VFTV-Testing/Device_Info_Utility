import type { EnvEntryInput, EnvWriteResult } from "../../shared/environment";
import type { AppConfigInfo, DevicesSnapshot, WriteResult } from "../../shared/types";
import { AUTH_HELPER_URL, type GitHubTarget } from "../config";
import { ApiError, type Api } from "./api";
import { createViewerEnvClient, type EnvApi } from "./environmentClient";

/**
 * Moderator sign-in: one shared key (given out by the tool owner) plus the person's name.
 * Moderators send Device health STATUS updates and device information changes to the
 * sign-in helper, which checks the key and commits with the GitHub App. Device data is read
 * through the helper too, so a moderator always sees the file as it is right after a save
 * (the public file server can lag a few minutes behind).
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

/**
 * Device information for moderators: read and saved through the helper (GitHub App), so the
 * same validation, conflict checks and commit messages apply as for team members.
 */
export function createModeratorDeviceClient(
  target: GitHubTarget,
  family: string,
  session: ModeratorSession,
  fetchFn: typeof fetch = (...a) => fetch(...a),
): Api {
  const write = (body: Record<string, unknown>) =>
    callHelper<WriteResult>("devices/write", session.key, { name: session.name, family, ...body }, fetchFn);
  return {
    getConfig: async (): Promise<AppConfigInfo> => ({
      storage: "github",
      location: `${target.owner}/${target.repo}@${target.branch}:${target.filePath}`,
      repoUrl: `https://github.com/${target.owner}/${target.repo}/blob/${encodeURIComponent(target.branch)}/${target.filePath}`,
      authEnabled: true,
      readOnly: false,
      moderator: session.name,
    }),
    getDevices: () => callHelper<DevicesSnapshot>("devices/read", session.key, { family }, fetchFn),
    initialize: async () => {
      throw new ApiError(403, "READ_ONLY", "Only team members can create a new device file.");
    },
    createRecord: (key, values) => write({ action: "create", key, values }),
    updateRecord: (key, base, values) => write({ action: "update", key, base, values }),
    deleteRecord: (key, base) => write({ action: "delete", key, base }),
    importRecords: (mode, mutations) => write({ action: "import", mode, mutations }),
  };
}
