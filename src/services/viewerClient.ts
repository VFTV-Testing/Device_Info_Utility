import { DeviceService } from "../../shared/deviceService";
import { AppError } from "../../shared/errors";
import type { DeviceFileStore, StoredFile, WriteOutcome } from "../../shared/storeTypes";
import type { AppConfigInfo } from "../../shared/types";
import type { GitHubTarget } from "../config";
import { ApiError, type Api } from "./api";

/**
 * View-only mode for people without a GitHub account (e.g. management).
 *
 * The data file lives in a PUBLIC repository, so it is read anonymously from
 * raw.githubusercontent.com — no token, no sign-in, nothing secret in the page.
 * (The anonymous REST API allows only 60 requests/hour per IP, which a shared office
 * network would exhaust; the raw file server has no such limit but caches for ≤ 5 minutes.)
 * Every write is refused here, and the UI hides all editing controls in this mode.
 */
export const RAW_BASE_URL = "https://raw.githubusercontent.com";

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

export class PublicRawFileStore implements DeviceFileStore {
  readonly kind = "github" as const;
  readonly readOnly = true;
  readonly location: string;
  readonly repoUrl: string;
  private readonly url: string;

  constructor(
    target: GitHubTarget,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {
    const path = target.filePath.split("/").map(encodeURIComponent).join("/");
    this.url = `${RAW_BASE_URL}/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/${encodeURIComponent(target.branch)}/${path}`;
    this.location = `${target.owner}/${target.repo}@${target.branch}:${target.filePath}`;
    this.repoUrl = `https://github.com/${target.owner}/${target.repo}/blob/${encodeURIComponent(target.branch)}/${target.filePath}`;
  }

  async read(): Promise<StoredFile | null> {
    let response: Response;
    try {
      // "no-cache" revalidates with the browser cache instead of reusing it blindly.
      response = await this.fetchFn(this.url, { cache: "no-cache" });
    } catch {
      throw new AppError(503, "GITHUB_UNAVAILABLE", "GitHub could not be reached. Check the network connection and try again.");
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new AppError(502, "GITHUB_UNAVAILABLE", `GitHub responded with an error (${response.status}) while reading the device file.`);
    const text = await response.text();
    const etag = response.headers.get("etag")?.replace(/"/g, "");
    return { text, version: etag || hashText(text) };
  }

  async write(): Promise<WriteOutcome> {
    throw new AppError(403, "READ_ONLY", VIEW_ONLY_MESSAGE);
  }
}

export function createViewerClient(target: GitHubTarget, fetchFn?: typeof fetch): Api {
  const store = new PublicRawFileStore(target, fetchFn);
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
