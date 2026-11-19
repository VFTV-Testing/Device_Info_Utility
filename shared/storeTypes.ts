/** Supplies the GitHub token for each request ("" = anonymous). */
export interface TokenProvider {
  getToken(): Promise<string>;
}

export interface StoredFile {
  text: string;
  /** Version used for optimistic concurrency (GitHub blob SHA or content hash). */
  version: string;
}

export interface WriteOutcome {
  version: string;
  commitSha: string;
  commitUrl?: string;
}

export interface WriteOptions {
  message: string;
  /** Version the change was based on; null when creating the file. */
  expectedVersion: string | null;
}

/**
 * Persistence backend for deviceInformation.json.
 * `write` MUST fail with a GITHUB_SHA_CONFLICT AppError when `expectedVersion`
 * is no longer the current version — this is what prevents lost updates.
 */
export interface DeviceFileStore {
  readonly kind: "github" | "local";
  /** Human-readable location for the UI (never contains credentials). */
  readonly location: string;
  readonly repoUrl?: string;
  /** True when the store cannot write (e.g. no GitHub credentials configured). */
  readonly readOnly: boolean;
  read(): Promise<StoredFile | null>;
  write(text: string, options: WriteOptions): Promise<WriteOutcome>;
}
