import { DeviceService } from "../../shared/deviceService";
import { AppError } from "../../shared/errors";
import type { DeviceFileStore, StoredFile, WriteOutcome } from "../../shared/storeTypes";
import type { AppConfigInfo } from "../../shared/types";
import { GITHUB_API_URL, type GitHubTarget } from "../config";
import { ApiError, type Api } from "./api";

/**
 * View-only mode for people without a GitHub account (e.g. management).
 *
 * The data file lives in a PUBLIC repository, so it is read anonymously — no token,
 * no sign-in, nothing secret in the page. Two sources, tried in order:
 *   1. raw.githubusercontent.com — no rate limit, cached ≤ 5 minutes.
 *   2. api.github.com (anonymous) — used when (1) is blocked or slow, which some company
 *      networks do. Limited to 60 requests/hour per network, but "not modified" answers
 *      (304, sent thanks to ETags) do not count, so periodic syncing stays cheap.
 * Whichever source answers first is remembered for the rest of the session.
 * Every write is refused here, and the UI hides all editing controls in this mode.
 */
export const RAW_BASE_URL = "https://raw.githubusercontent.com";
const REQUEST_TIMEOUT_MS = 6_000;
const VIEW_ONLY_MESSAGE = "View-only mode — sign in with GitHub to make changes.";

/** Small, stable content hash used as the version when the server sends no ETag. */
function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `raw-${(h >>> 0).toString(16)}-${text.length}`;
}

interface Source {
  name: "raw" | "api";
  url: string;
  init: RequestInit;
}

type Attempt = { ok: true; file: StoredFile | null } | { ok: false; reason: string; rateLimited?: boolean };

export class PublicRawFileStore implements DeviceFileStore {
  readonly kind = "github" as const;
  readonly readOnly = true;
  readonly location: string;
  readonly repoUrl: string;
  private readonly sources: Source[];
  /** Index of the source that last worked; tried first next time. */
  private preferred = 0;

  constructor(
    target: GitHubTarget,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
    private readonly timeoutMs = REQUEST_TIMEOUT_MS,
  ) {
    const enc = encodeURIComponent;
    const path = target.filePath.split("/").map(enc).join("/");
    this.location = `${target.owner}/${target.repo}@${target.branch}:${target.filePath}`;
    this.repoUrl = `https://github.com/${target.owner}/${target.repo}/blob/${enc(target.branch)}/${target.filePath}`;
    this.sources = [
      // "no-cache" revalidates with the browser cache (ETag) instead of reusing it blindly.
      { name: "raw", url: `${RAW_BASE_URL}/${enc(target.owner)}/${enc(target.repo)}/${enc(target.branch)}/${path}`, init: { cache: "no-cache" } },
      {
        name: "api",
        url: `${GITHUB_API_URL}/repos/${enc(target.owner)}/${enc(target.repo)}/contents/${path}?ref=${enc(target.branch)}`,
        // The "raw" media type returns the file text directly (no base64 / size limit for this file).
        init: { cache: "no-cache", headers: { Accept: "application/vnd.github.raw", "X-GitHub-Api-Version": "2022-11-28" } },
      },
    ];
  }

  private async attempt(source: Source): Promise<Attempt> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(source.url, { ...source.init, signal: controller.signal });
      if (response.status === 404) return { ok: true, file: null };
      if (!response.ok) {
        const rateLimited = response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0");
        return { ok: false, reason: `${source.name} responded ${response.status}`, rateLimited };
      }
      const text = await response.text();
      const etag = response.headers.get("etag")?.replace(/^W\//, "").replace(/"/g, "");
      return { ok: true, file: { text, version: etag || hashText(text) } };
    } catch (error) {
      const aborted = (error as Error)?.name === "AbortError";
      return { ok: false, reason: `${source.name} ${aborted ? "timed out" : "unreachable"}` };
    } finally {
      clearTimeout(timer);
    }
  }

  async read(): Promise<StoredFile | null> {
    const order = [this.preferred, ...this.sources.map((_, i) => i).filter((i) => i !== this.preferred)];
    const failures: Attempt[] = [];
    for (const index of order) {
      const result = await this.attempt(this.sources[index]!);
      if (result.ok) {
        this.preferred = index;
        return result.file;
      }
      failures.push(result);
    }
    if (failures.some((f) => !f.ok && f.rateLimited)) {
      throw new AppError(
        429,
        "GITHUB_RATE_LIMITED",
        "GitHub is limiting anonymous requests from this network right now. Please try again in a few minutes, or sign in with GitHub.",
      );
    }
    throw new AppError(
      503,
      "GITHUB_UNAVAILABLE",
      "GitHub could not be reached from this network. If you are on a company network or VPN, it may be blocking GitHub — try another network or ask IT to allow raw.githubusercontent.com and api.github.com.",
      { attempts: failures.map((f) => (!f.ok ? f.reason : "")) },
    );
  }

  async write(): Promise<WriteOutcome> {
    throw new AppError(403, "READ_ONLY", VIEW_ONLY_MESSAGE);
  }
}

export function createViewerClient(target: GitHubTarget, fetchFn?: typeof fetch, timeoutMs?: number): Api {
  const store = new PublicRawFileStore(target, fetchFn, timeoutMs);
  const service = new DeviceService(store);
  const refuse = async (): Promise<never> => {
    throw new ApiError(403, "READ_ONLY", VIEW_ONLY_MESSAGE);
  };
  return {
    getConfig: async (): Promise<AppConfigInfo> => ({
      storage: "github",
      location: store.location,
      repoUrl: store.repoUrl,
      authEnabled: true,
      readOnly: true,
      viewOnly: true,
    }),
    getDevices: async () => {
      try {
        return await service.getSnapshot();
      } catch (error) {
        if (error instanceof AppError) throw new ApiError(error.status, error.code, error.message, error.details);
        throw new ApiError(0, "NETWORK", "GitHub could not be reached. Check your network connection.");
      }
    },
    initialize: refuse,
    createRecord: refuse,
    updateRecord: refuse,
    deleteRecord: refuse,
    importRecords: refuse,
  };
}
