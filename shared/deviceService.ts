import { parseDeviceId } from "./deviceId";
import { applyMutations, sanitizeMutations, validateMutations } from "./operations";
import { detectFormat, serializeDeviceData, type JsonFormat } from "./serialize";
import { MAX_KEY_LENGTH, validateDeviceData, validateNewKeyParts } from "./validation";
import type { DeviceData, DeviceRecord, DevicesSnapshot, ImportMode, Mutation, WriteResult } from "./types";
import { AppError, RecordConflictError } from "./errors";
import type { DeviceFileStore } from "./storeTypes";

const MAX_WRITE_ATTEMPTS = 3;

interface LoadedFile {
  data: DeviceData;
  version: string;
  format: JsonFormat;
}

function requireKey(key: unknown): string {
  if (typeof key !== "string" || key.trim() === "" || key.length > MAX_KEY_LENGTH) {
    throw new AppError(400, "VALIDATION_FAILED", "A valid device identifier is required.");
  }
  return key;
}

function describeKey(key: string): string {
  const id = parseDeviceId(key);
  return id ? `${id.device} ${id.port}` : key;
}

/** Builds a meaningful commit message, e.g. "Update device information: X101-GER PORT1". */
export function buildCommitMessage(mutations: Mutation[], actor?: string): string {
  let title: string;
  if (mutations.length === 1) {
    const m = mutations[0]!;
    const verb = m.type === "create" ? "Add" : m.type === "update" ? "Update" : "Delete";
    title = `${verb} device information: ${describeKey(m.key)}`;
  } else {
    const added = mutations.filter((m) => m.type === "create").length;
    const updated = mutations.filter((m) => m.type === "update").length;
    const deleted = mutations.filter((m) => m.type === "delete").length;
    const parts = [added && `${added} added`, updated && `${updated} updated`, deleted && `${deleted} deleted`].filter(Boolean);
    title = `Import device information: ${parts.join(", ")}`;
  }
  const body = mutations.length === 1 ? [`Record: ${mutations[0]!.key}`] : mutations.map((m) => `- ${m.type}: ${m.key}`);
  if (actor) body.push("", `Requested by: ${actor} (via Device Information Manager)`);
  return `${title}\n\n${body.join("\n")}`;
}

export class DeviceService {
  /** Serialises writes inside this process; cross-process safety comes from the SHA check. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly store: DeviceFileStore) {}

  private async loadFile(): Promise<LoadedFile> {
    const file = await this.store.read();
    if (!file) {
      throw new AppError(404, "FILE_MISSING", "The device information file does not exist yet. It can be initialised as an empty file.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.text);
    } catch (error) {
      throw new AppError(422, "FILE_INVALID", `The device file is not valid JSON: ${(error as Error).message}. Fix it in GitHub before editing.`);
    }
    const result = validateDeviceData(parsed);
    if (!result.ok) {
      throw new AppError(422, "FILE_INVALID", "The device file does not match the expected structure. Fix it in GitHub before editing.", {
        problems: result.errors.slice(0, 50),
      });
    }
    return { data: result.data, version: file.version, format: detectFormat(file.text) };
  }

  async getSnapshot(): Promise<DevicesSnapshot> {
    const file = await this.loadFile();
    return { data: file.data, version: file.version, fetchedAt: new Date().toISOString() };
  }

  /**
   * Applies record-level changes on top of the LATEST file:
   *   fetch latest + SHA → check conflicts per record → merge → validate → commit with SHA.
   * If GitHub reports the SHA is stale (someone committed in between) the whole
   * cycle is retried, so unrelated concurrent changes are never lost.
   */
  applyChanges(input: Mutation[], actor?: string): Promise<WriteResult> {
    const run = async (): Promise<WriteResult> => {
      this.assertWritable();
      const problems = validateMutations(input);
      if (problems.length) throw new AppError(400, "VALIDATION_FAILED", problems[0]!, { problems });
      const mutations = sanitizeMutations(input);
      const message = buildCommitMessage(mutations, actor);

      for (let attempt = 1; ; attempt++) {
        const latest = await this.loadFile();
        const result = applyMutations(latest.data, mutations);
        if (result.conflicts.length) throw new RecordConflictError(result.conflicts);

        if (result.changed === 0) {
          // Nothing to commit (e.g. identical values already saved) — report honestly.
          throw new AppError(409, "NO_CHANGES", "No changes to save — GitHub already contains these values.");
        }
        const check = validateDeviceData(result.data);
        if (!check.ok) throw new AppError(500, "INTERNAL", "The updated file failed validation and was not saved.");

        const text = serializeDeviceData(result.data, latest.format);
        try {
          const outcome = await this.store.write(text, { message, expectedVersion: latest.version });
          return {
            data: result.data,
            version: outcome.version,
            fetchedAt: new Date().toISOString(),
            commit: { sha: outcome.commitSha, url: outcome.commitUrl, message: message.split("\n")[0]! },
          };
        } catch (error) {
          if (error instanceof AppError && error.code === "GITHUB_SHA_CONFLICT" && attempt < MAX_WRITE_ATTEMPTS) continue;
          throw error;
        }
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  // ── Request-level operations (shared by the Express API and the browser-only client) ──

  createRecord(key: unknown, values: unknown, actor?: string): Promise<WriteResult> {
    const k = requireKey(key);
    const id = parseDeviceId(k);
    if (!id) throw new AppError(400, "VALIDATION_FAILED", "The identifier must follow <device>-PORT<n>-<remaining segments>.");
    const firstKeyError = Object.values(validateNewKeyParts({ device: id.device, port: id.port, suffix: id.suffix }, {}))[0];
    if (firstKeyError) throw new AppError(400, "VALIDATION_FAILED", firstKeyError);
    return this.applyChanges([{ type: "create", key: k, values: values as DeviceRecord }], actor);
  }

  updateRecord(key: unknown, base: unknown, values: unknown, actor?: string): Promise<WriteResult> {
    return this.applyChanges([{ type: "update", key: requireKey(key), base: base as DeviceRecord, values: values as DeviceRecord }], actor);
  }

  deleteRecord(key: unknown, base: unknown, actor?: string): Promise<WriteResult> {
    return this.applyChanges([{ type: "delete", key: requireKey(key), base: base as DeviceRecord }], actor);
  }

  /** Add-only imports may only create; no import may delete. */
  importRecords(mode: unknown, mutations: unknown, actor?: string): Promise<WriteResult> {
    if (mode !== "add-only" && mode !== "update-existing") {
      throw new AppError(400, "VALIDATION_FAILED", 'Import mode must be "add-only" or "update-existing".');
    }
    if (!Array.isArray(mutations) || mutations.length === 0) {
      throw new AppError(400, "VALIDATION_FAILED", "The import does not contain any changes.");
    }
    for (const m of mutations as Array<{ type?: unknown; key?: unknown }>) {
      if (m?.type === "delete") throw new AppError(400, "VALIDATION_FAILED", "Imports cannot delete records.");
      if ((mode as ImportMode) === "add-only" && m?.type !== "create") {
        throw new AppError(400, "VALIDATION_FAILED", "Add-only imports cannot modify existing records.");
      }
      requireKey(m?.key);
    }
    return this.applyChanges(mutations as Mutation[], actor);
  }

  private assertWritable(): void {
    if (this.store.readOnly) {
      throw new AppError(403, "READ_ONLY", "Read-only: these GitHub credentials cannot save changes to this repository.");
    }
  }

  /** Creates the file as "{}" — only if it does not exist. Never overwrites. */
  async initialize(actor?: string): Promise<WriteResult> {
    this.assertWritable();
    const existing = await this.store.read();
    if (existing) throw new AppError(409, "FILE_EXISTS", "The device file already exists. It was not replaced.");
    const message = `Initialize device information file${actor ? `\n\nRequested by: ${actor} (via Device Information Manager)` : ""}`;
    const outcome = await this.store.write("{}\n", { message, expectedVersion: null });
    return {
      data: {},
      version: outcome.version,
      fetchedAt: new Date().toISOString(),
      commit: { sha: outcome.commitSha, url: outcome.commitUrl, message: "Initialize device information file" },
    };
  }
}
