import { AppError } from "./errors";
import type { DeviceFileStore, StoredFile, TokenProvider, WriteOptions, WriteOutcome } from "./storeTypes";

/** UTF-8 safe base64 helpers that work in both browsers and Node. */
export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function base64ToUtf8(base64: string): string {
  const binary = atob(base64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export interface GitHubStoreOptions {
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
  apiUrl: string;
  tokens: TokenProvider;
  committer?: { name: string; email: string };
  fetchFn?: typeof fetch;
  /** No credentials configured: read anonymously, refuse writes. */
  readOnly?: boolean;
}

interface ContentsResponse {
  type: string;
  sha: string;
  size: number;
  encoding?: string;
  content?: string;
}

/**
 * Reads and commits deviceInformation.json through the GitHub REST "contents" API.
 * Every commit is made against an explicit blob SHA, so GitHub itself rejects a
 * write that is based on a stale version (HTTP 409).
 */
export class GitHubFileStore implements DeviceFileStore {
  readonly kind = "github" as const;
  readonly location: string;
  readonly repoUrl: string;
  readonly readOnly: boolean;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly opts: GitHubStoreOptions) {
    this.location = `${opts.owner}/${opts.repo}@${opts.branch}:${opts.filePath}`;
    const webBase = opts.apiUrl === "https://api.github.com" ? "https://github.com" : opts.apiUrl.replace(/\/api\/v3$/, "");
    this.repoUrl = `${webBase}/${opts.owner}/${opts.repo}/blob/${encodeURIComponent(opts.branch)}/${opts.filePath}`;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.readOnly = Boolean(opts.readOnly);
  }

  private repoPath(): string {
    return `/repos/${encodeURIComponent(this.opts.owner)}/${encodeURIComponent(this.opts.repo)}`;
  }

  private contentsPath(): string {
    const encodedPath = this.opts.filePath.split("/").map(encodeURIComponent).join("/");
    return `${this.repoPath()}/contents/${encodedPath}`;
  }

  private async request(pathAndQuery: string, init: RequestInit = {}, retries = 0): Promise<Response> {
    const token = await this.opts.tokens.getToken();
    try {
      return await this.fetchFn(`${this.opts.apiUrl}${pathAndQuery}`, {
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "device-information-manager",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
      });
    } catch {
      if (retries > 0) return this.request(pathAndQuery, init, retries - 1);
      throw new AppError(503, "GITHUB_UNAVAILABLE", "GitHub could not be reached. Check the network connection and try again.");
    }
  }

  /** Maps GitHub error responses to safe, user-facing errors. */
  private async toError(response: Response, context: string): Promise<AppError> {
    let message = "";
    try {
      message = ((await response.json()) as { message?: string }).message ?? "";
    } catch {
      /* ignore body parse errors */
    }
    const status = response.status;
    if (status === 401) {
      return new AppError(502, "GITHUB_AUTH_FAILED", "GitHub rejected the credentials. The token may be invalid, expired or revoked.");
    }
    if (status === 429 || (status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || /rate limit/i.test(message)))) {
      const reset = Number(response.headers.get("x-ratelimit-reset"));
      const when = reset ? ` Try again after ${new Date(reset * 1000).toLocaleTimeString()}.` : " Try again in a few minutes.";
      return new AppError(429, "GITHUB_RATE_LIMITED", `GitHub API rate limit reached.${when}`);
    }
    if (status === 403) {
      return new AppError(502, "GITHUB_PERMISSION_DENIED", `The GitHub credentials in use do not have permission to ${context}. Write access to the repository and a token with "Contents: Read and write" are required.`);
    }
    if (status === 409 || (status === 422 && /sha/i.test(message))) {
      return new AppError(409, "GITHUB_SHA_CONFLICT", "The file was changed in GitHub while saving.");
    }
    if (status === 404) {
      return new AppError(502, "GITHUB_NOT_FOUND", `GitHub returned "not found" while trying to ${context}.`);
    }
    if (status >= 500) {
      return new AppError(503, "GITHUB_UNAVAILABLE", "GitHub is temporarily unavailable. Try again shortly.");
    }
    return new AppError(502, "GITHUB_UNAVAILABLE", `GitHub request failed (${status}) while trying to ${context}.`);
  }

  /** Called when the file returns 404, to tell "missing file" apart from "missing repo/branch". */
  private async explainNotFound(): Promise<void> {
    const repo = await this.request(this.repoPath());
    if (repo.status === 404) {
      throw new AppError(502, "GITHUB_NOT_FOUND", `Repository ${this.opts.owner}/${this.opts.repo} was not found, or the credentials in use cannot access it.`);
    }
    if (!repo.ok) throw await this.toError(repo, "read the repository");
    const branch = await this.request(`${this.repoPath()}/branches/${encodeURIComponent(this.opts.branch)}`);
    if (branch.status === 404) {
      throw new AppError(502, "GITHUB_NOT_FOUND", `Branch "${this.opts.branch}" does not exist in ${this.opts.owner}/${this.opts.repo}.`);
    }
    if (!branch.ok) throw await this.toError(branch, "read the branch");
  }

  async read(): Promise<StoredFile | null> {
    const response = await this.request(`${this.contentsPath()}?ref=${encodeURIComponent(this.opts.branch)}`, {}, 1);
    if (response.status === 404) {
      await this.explainNotFound();
      return null; // repo and branch exist → the file itself is missing
    }
    if (!response.ok) throw await this.toError(response, "read the device file");

    const body = (await response.json()) as ContentsResponse;
    if (body.type !== "file") {
      throw new AppError(502, "FILE_INVALID", `"${this.opts.filePath}" in GitHub is not a file.`);
    }
    let base64 = body.encoding === "base64" ? body.content : undefined;
    if (!base64) {
      // Files over 1 MB are not inlined by the contents API — fetch the blob instead.
      const blob = await this.request(`${this.repoPath()}/git/blobs/${body.sha}`, {}, 1);
      if (!blob.ok) throw await this.toError(blob, "read the device file");
      base64 = ((await blob.json()) as { content: string }).content;
    }
    const text = base64ToUtf8(base64);
    return { text, version: body.sha };
  }

  async write(text: string, options: WriteOptions): Promise<WriteOutcome> {
    if (this.readOnly) {
      throw new AppError(403, "READ_ONLY", "Read-only: these GitHub credentials cannot save changes to this repository.");
    }
    const payload: Record<string, unknown> = {
      message: options.message,
      content: utf8ToBase64(text),
      branch: this.opts.branch,
    };
    if (options.expectedVersion) payload.sha = options.expectedVersion;
    if (this.opts.committer) payload.committer = this.opts.committer;

    const response = await this.request(this.contentsPath(), { method: "PUT", body: JSON.stringify(payload) });
    if (response.status === 422 && !options.expectedVersion) {
      throw new AppError(409, "FILE_EXISTS", "The device file already exists in GitHub. It was not replaced.");
    }
    if (!response.ok) throw await this.toError(response, "commit the device file");

    const body = (await response.json()) as { content: { sha: string }; commit: { sha: string; html_url?: string } };
    if (!body?.commit?.sha || !body?.content?.sha) {
      throw new AppError(502, "GITHUB_UNAVAILABLE", "GitHub did not confirm the commit. Refresh to check whether it was saved.");
    }
    return { version: body.content.sha, commitSha: body.commit.sha, commitUrl: body.commit.html_url };
  }
}
