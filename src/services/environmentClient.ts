import { EnvironmentService, type EnvEntryInput, type EnvSnapshot, type EnvWriteResult } from "../../shared/environment";
import { AppError } from "../../shared/errors";
import { GitHubFileStore } from "../../shared/githubStore";
import { GITHUB_API_URL, type GitHubTarget } from "../config";
import { ApiError, request } from "./api";
import { ensureFreshSession, type GitHubSession } from "./githubSession";
import { PublicRawFileStore } from "./viewerClient";

/** What the Environment tab needs: load the file and append an update. */
export interface EnvLoadResult extends EnvSnapshot {
  readOnly: boolean;
  location: string;
}

export interface EnvApi {
  load(): Promise<EnvLoadResult>;
  /** Saves several updates in one commit. */
  addEntries(inputs: EnvEntryInput[]): Promise<EnvWriteResult>;
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof AppError) {
    if (error.code === "GITHUB_PERMISSION_DENIED") {
      return new ApiError(
        error.status,
        error.code,
        "Your GitHub sign-in cannot save to the Environment file. Ask the repository owner to give you Write access to it, and make sure the sign-in app is installed on that repository.",
        error.details,
      );
    }
    return new ApiError(error.status, error.code, error.message, error.details);
  }
  return new ApiError(0, "NETWORK", "GitHub could not be reached. Check your network connection.");
}

async function wrap<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toApiError(error);
  }
}

/** Local/server mode: the Express API (/api/environment). */
export const serverEnvApi: EnvApi = {
  load: () => request<EnvLoadResult>("GET", "/environment"),
  addEntries: (inputs) => request<EnvWriteResult>("POST", "/environment/entries", { entries: inputs }),
};

/**
 * Signed-in team members: read and commit with their own GitHub sign-in, so every
 * update is a commit under their name. Write access is checked on the repository itself.
 */
export function createDirectEnvClient(target: GitHubTarget, session: GitHubSession, fetchFn: typeof fetch = (...a) => fetch(...a)): EnvApi {
  let service: EnvironmentService | null = null;

  const getService = async (): Promise<EnvironmentService> => {
    if (service) return service;
    const token = (await ensureFreshSession(session)).token;
    let canWrite = false;
    try {
      const res = await fetchFn(`${GITHUB_API_URL}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`, {
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
      });
      if (res.ok) canWrite = Boolean(((await res.json()) as { permissions?: { push?: boolean } }).permissions?.push);
    } catch {
      /* treat as read-only; reading still works */
    }
    service = new EnvironmentService(
      new GitHubFileStore({
        ...target,
        apiUrl: GITHUB_API_URL,
        tokens: { getToken: async () => (await ensureFreshSession(session)).token },
        fetchFn,
        readOnly: !canWrite,
      }),
    );
    return service;
  };

  return {
    load: () =>
      wrap(async () => {
        const s = await getService();
        return { ...(await s.getSnapshot()), readOnly: s.readOnly, location: s.location };
      }),
    // Commits are authored by the signed-in user; the login is also recorded on the entry.
    addEntries: (inputs) => wrap(async () => (await getService()).addEntries(inputs, session.login)),
  };
}

/** View-only visitors: anonymous read of the public file, no writes. */
export function createViewerEnvClient(target: GitHubTarget, fetchFn?: typeof fetch): EnvApi {
  const service = new EnvironmentService(new PublicRawFileStore(target, fetchFn));
  return {
    load: () => wrap(async () => ({ ...(await service.getSnapshot()), readOnly: true, location: service.location })),
    addEntries: async () => {
      throw new ApiError(403, "READ_ONLY", "View-only mode — sign in with GitHub to update the environment status.");
    },
  };
}
