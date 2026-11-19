import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../../shared/errors";
import type { DeviceFileStore, StoredFile, WriteOptions, WriteOutcome } from "../../shared/storeTypes";

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * DEVELOPMENT / OFFLINE ONLY. Reads and writes a JSON file on the server's disk.
 * It applies the same optimistic-concurrency rules as the GitHub store but does
 * NOT commit to Git. Use STORAGE_MODE=github for real use.
 */
export class LocalFileStore implements DeviceFileStore {
  readonly kind = "local" as const;
  readonly readOnly = false;
  readonly location: string;

  constructor(private readonly filePath: string) {
    this.location = `Local file: ${path.basename(filePath)} (development mode — not committed to GitHub)`;
  }

  async read(): Promise<StoredFile | null> {
    try {
      const text = await readFile(this.filePath, "utf8");
      return { text, version: hash(text) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new AppError(500, "INTERNAL", "The local data file could not be read.");
    }
  }

  async write(text: string, options: WriteOptions): Promise<WriteOutcome> {
    const current = await this.read();
    if (options.expectedVersion === null && current) {
      throw new AppError(409, "FILE_EXISTS", "The device file already exists. It was not replaced.");
    }
    if (options.expectedVersion !== null && current?.version !== options.expectedVersion) {
      throw new AppError(409, "GITHUB_SHA_CONFLICT", "The file was changed while saving.");
    }
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tmp, text, "utf8");
    await rename(tmp, this.filePath);
    const version = hash(text);
    return { version, commitSha: `local-${version.slice(0, 12)}` };
  }
}
