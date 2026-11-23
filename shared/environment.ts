import { naturalCompare } from "./deviceId";
import { AppError } from "./errors";
import type { DeviceFileStore } from "./storeTypes";
import type { CommitInfo } from "./types";

/**
 * Environment tracking: the current problem (if any) of each robot's device port,
 * with the full history of every update.
 *
 * Stored in its own file (default: environment/environmentStatus.json in the app repo),
 * never in deviceInformation.json, so test automation is unaffected. Shape:
 *
 *   { "version": 1, "ports": { "X117-AL": { "PORT1": [ {entry}, {entry}, … ] } } }
 *
 * Entries are append-only (oldest first); the last entry is the current status.
 * Keyed by robot + port — not the full device identifier — so the history stays with
 * the port when a box is replaced.
 */
export const ENV_STATUSES = ["ok", "issue", "down"] as const;
export type EnvStatus = (typeof ENV_STATUSES)[number];

export const ENV_CATEGORIES = ["environment", "bluetooth", "box", "network", "ir", "replaced", "other"] as const;
export type EnvCategory = (typeof ENV_CATEGORIES)[number];

export const ENV_STATUS_LABELS: Record<EnvStatus, string> = { ok: "OK", issue: "Issue", down: "Down" };
export const ENV_CATEGORY_LABELS: Record<EnvCategory, string> = {
  environment: "Environment / setup",
  bluetooth: "Bluetooth / remote",
  box: "Box not working",
  network: "Network / internet",
  ir: "IR",
  replaced: "Box replaced",
  other: "Other",
};

export const MAX_NOTE_LENGTH = 4000;
export const MAX_SETUP_LENGTH = 1000;

export interface EnvEntry {
  /** ISO time the entry was saved (set by the service, not the client). */
  at: string;
  /** GitHub login (or server user) who saved it. */
  by?: string;
  status: EnvStatus;
  /** Issue type — only for Issue / Down. OK entries are a plain comment without one. */
  category?: EnvCategory;
  note: string;
}

/**
 * Setup info: permanent facts about a port (router/port, VLAN, modem, Wi-Fi, manual device,
 * HW change…). Kept apart from the status so it stays visible whatever the status is.
 * Also append-only; the last entry is the current setup ("" = cleared).
 */
export interface SetupEntry {
  at: string;
  by?: string;
  note: string;
}

export interface EnvironmentDoc {
  version: 1;
  /** Status history per robot → port. */
  ports: Record<string, Record<string, EnvEntry[]>>;
  /** Setup-info history per robot → port. */
  setup?: Record<string, Record<string, SetupEntry[]>>;
}

export interface EnvSnapshot {
  doc: EnvironmentDoc;
  /** null while the file does not exist yet (it is created by the first save). */
  version: string | null;
  fetchedAt: string;
}

export interface EnvWriteResult extends EnvSnapshot {
  commit: CommitInfo;
}

/**
 * One port's update. It can change the status, the setup info, or both:
 * leave `status` out to change only the setup, leave `setup` out to change only the status.
 */
export interface EnvEntryInput {
  robot: string;
  port: string;
  status?: EnvStatus;
  /** Required for Issue / Down; ignored for OK. */
  category?: EnvCategory;
  /** Status note (required for Issue / Down). */
  note?: string;
  /** New setup info for the port ("" clears it). */
  setup?: string;
}

export const EMPTY_ENV_DOC: EnvironmentDoc = { version: 1, ports: {} };

const ROBOT_PATTERN = /^[A-Za-z0-9_&.+]+(?:-[A-Za-z0-9_&.+]+)*$/;
/** Every device family shares this file: ports are PORT1 (STB, Mobile) or P1 (Smart TV). */
const ENV_PORT_PATTERN = /^(?:PORT|P)[1-9]\d*$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Problems with one entry, empty when valid. */
function entryProblems(value: unknown, where: string): string[] {
  if (!isObject(value)) return [`${where}: entry must be an object`];
  const problems: string[] = [];
  if (typeof value.at !== "string" || Number.isNaN(Date.parse(value.at))) problems.push(`${where}: "at" must be a date`);
  if (value.by !== undefined && typeof value.by !== "string") problems.push(`${where}: "by" must be text`);
  if (!ENV_STATUSES.includes(value.status as EnvStatus)) problems.push(`${where}: unknown status "${String(value.status)}"`);
  if (value.category !== undefined && !ENV_CATEGORIES.includes(value.category as EnvCategory)) problems.push(`${where}: unknown issue type "${String(value.category)}"`);
  if (value.status !== "ok" && value.category === undefined) problems.push(`${where}: an issue needs an issue type`);
  if (typeof value.note !== "string") problems.push(`${where}: "note" must be text`);
  return problems;
}

function setupProblems(value: unknown, where: string): string[] {
  if (!isObject(value)) return [`${where}: setup entry must be an object`];
  const problems: string[] = [];
  if (typeof value.at !== "string" || Number.isNaN(Date.parse(value.at))) problems.push(`${where}: "at" must be a date`);
  if (value.by !== undefined && typeof value.by !== "string") problems.push(`${where}: "by" must be text`);
  if (typeof value.note !== "string") problems.push(`${where}: setup "note" must be text`);
  return problems;
}

export function validateEnvDoc(value: unknown): { ok: true; doc: EnvironmentDoc } | { ok: false; errors: string[] } {
  if (!isObject(value)) return { ok: false, errors: ["The environment file must contain a JSON object"] };
  if (value.version !== 1) return { ok: false, errors: [`Unsupported environment file version "${String(value.version)}"`] };
  if (!isObject(value.ports)) return { ok: false, errors: ['"ports" must be an object'] };
  const errors: string[] = [];
  if (value.setup !== undefined) {
    if (!isObject(value.setup)) errors.push('"setup" must be an object');
    else
      for (const [robot, ports] of Object.entries(value.setup)) {
        if (!isObject(ports)) {
          errors.push(`setup ${robot}: must map ports to entries`);
          continue;
        }
        for (const [port, entries] of Object.entries(ports)) {
          if (!Array.isArray(entries)) errors.push(`setup ${robot} ${port}: entries must be a list`);
          else entries.forEach((entry, i) => errors.push(...setupProblems(entry, `setup ${robot} ${port} #${i + 1}`)));
        }
      }
  }
  for (const [robot, ports] of Object.entries(value.ports)) {
    if (!isObject(ports)) {
      errors.push(`${robot}: must map ports to entries`);
      continue;
    }
    for (const [port, entries] of Object.entries(ports)) {
      if (!Array.isArray(entries)) {
        errors.push(`${robot} ${port}: entries must be a list`);
        continue;
      }
      entries.forEach((entry, i) => errors.push(...entryProblems(entry, `${robot} ${port} #${i + 1}`)));
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, doc: value as unknown as EnvironmentDoc };
}

export function validateEntryInput(input: unknown): string[] {
  if (!isObject(input)) return ["The update must be an object"];
  const problems: string[] = [];
  if (typeof input.robot !== "string" || !ROBOT_PATTERN.test(input.robot)) problems.push("A valid robot is required");
  if (typeof input.port !== "string" || !ENV_PORT_PATTERN.test(input.port)) problems.push("A valid device port is required (e.g. PORT1)");
  if (input.status === undefined && input.setup === undefined) problems.push("Nothing to update");
  if (input.status !== undefined) {
    if (!ENV_STATUSES.includes(input.status as EnvStatus)) problems.push("Choose a status");
    if (input.status !== "ok" && !ENV_CATEGORIES.includes(input.category as EnvCategory)) problems.push("Choose an issue type");
    const note = input.note ?? "";
    if (typeof note !== "string") problems.push("The note must be text");
    else if (note.length > MAX_NOTE_LENGTH) problems.push(`The note is too long (max ${MAX_NOTE_LENGTH} characters)`);
    else if (input.status !== "ok" && note.trim() === "") problems.push("Describe the issue in the note");
  }
  if (input.setup !== undefined) {
    if (typeof input.setup !== "string") problems.push("Setup info must be text");
    else if (input.setup.length > MAX_SETUP_LENGTH) problems.push(`Setup info is too long (max ${MAX_SETUP_LENGTH} characters)`);
  }
  return problems;
}

function sortNested<T>(map: Record<string, Record<string, T>>): Record<string, Record<string, T>> {
  const out: Record<string, Record<string, T>> = {};
  for (const robot of Object.keys(map).sort(naturalCompare)) {
    const byPort = map[robot]!;
    out[robot] = {};
    for (const port of Object.keys(byPort).sort(naturalCompare)) out[robot]![port] = byPort[port]!;
  }
  return out;
}

/** Stable, readable JSON: robots and ports in natural order, 2-space indent, trailing newline. */
export function serializeEnvDoc(doc: EnvironmentDoc): string {
  const out: EnvironmentDoc = { version: 1, ports: sortNested(doc.ports) };
  if (doc.setup && Object.keys(doc.setup).length) out.setup = sortNested(doc.setup);
  return `${JSON.stringify(out, null, 2)}\n`;
}

export function setupFor(doc: EnvironmentDoc, robot: string, port: string): SetupEntry[] {
  return doc.setup?.[robot]?.[port] ?? [];
}

/** Current setup info ("" when none). */
export function currentSetup(doc: EnvironmentDoc, robot: string, port: string): string {
  const list = setupFor(doc, robot, port);
  return list[list.length - 1]?.note ?? "";
}

export function entriesFor(doc: EnvironmentDoc, robot: string, port: string): EnvEntry[] {
  return doc.ports[robot]?.[port] ?? [];
}

export function latestEntry(entries: EnvEntry[]): EnvEntry | undefined {
  return entries[entries.length - 1];
}

function describeChange(input: EnvEntryInput): string {
  const parts: string[] = [];
  if (input.status) {
    const type = input.status !== "ok" && input.category ? ` (${ENV_CATEGORY_LABELS[input.category]})` : "";
    parts.push(`→ ${ENV_STATUS_LABELS[input.status]}${type}`);
  }
  if (input.setup !== undefined) parts.push(input.setup.trim() ? "setup updated" : "setup cleared");
  return `${input.robot} ${input.port} ${parts.join(", ")}`;
}

function detail(input: EnvEntryInput): string {
  const parts: string[] = [];
  if (input.status && input.note?.trim()) parts.push(input.note.trim().replace(/\s+/g, " "));
  if (input.setup?.trim()) parts.push(`Setup: ${input.setup.trim().replace(/\s+/g, " ")}`);
  return parts.join(" | ");
}

function commitMessage(inputs: EnvEntryInput[], actor?: string): string {
  let title: string;
  let body: string[];
  if (inputs.length === 1) {
    title = `Environment: ${describeChange(inputs[0]!)}`;
    body = [detail(inputs[0]!) || "(no note)"];
  } else {
    title = `Environment: ${inputs.length} updates`;
    body = inputs.map((i) => `- ${describeChange(i)}${detail(i) ? `: ${detail(i)}` : ""}`);
  }
  if (actor) body.push("", `Requested by: ${actor} (via Device Information Manager)`);
  return `${title}\n\n${body.join("\n")}`;
}

const MAX_WRITE_ATTEMPTS = 3;

export class EnvironmentService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly store: DeviceFileStore) {}

  get readOnly(): boolean {
    return this.store.readOnly;
  }

  get location(): string {
    return this.store.location;
  }

  private async load(): Promise<{ doc: EnvironmentDoc; version: string | null }> {
    const file = await this.store.read();
    if (!file) return { doc: EMPTY_ENV_DOC, version: null };
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.text);
    } catch (error) {
      throw new AppError(422, "FILE_INVALID", `The environment file is not valid JSON: ${(error as Error).message}`);
    }
    const result = validateEnvDoc(parsed);
    if (!result.ok) {
      throw new AppError(422, "FILE_INVALID", "The environment file does not match the expected structure.", { problems: result.errors.slice(0, 50) });
    }
    return { doc: result.doc, version: file.version };
  }

  async getSnapshot(): Promise<EnvSnapshot> {
    const { doc, version } = await this.load();
    return { doc, version, fetchedAt: new Date().toISOString() };
  }

  /** Appends one entry (see addEntries). */
  addEntry(input: unknown, actor?: string): Promise<EnvWriteResult> {
    return this.addEntries([input], actor);
  }

  /**
   * Appends one entry per update to the ports' histories, all in ONE commit, on top of
   * the LATEST file. Appends never conflict with each other, so a concurrent save is
   * simply retried and everyone's entries are kept. Nothing is saved if any update is invalid.
   */
  addEntries(inputs: unknown, actor?: string): Promise<EnvWriteResult> {
    const run = async (): Promise<EnvWriteResult> => {
      if (this.store.readOnly) throw new AppError(403, "READ_ONLY", "Read-only: these credentials cannot save environment updates.");
      if (!Array.isArray(inputs) || inputs.length === 0) throw new AppError(400, "VALIDATION_FAILED", "There are no updates to save.");
      const problems = inputs.flatMap((input, i) => validateEntryInput(input).map((p) => (inputs.length > 1 ? `Update ${i + 1}: ${p}` : p)));
      if (problems.length) throw new AppError(400, "VALIDATION_FAILED", problems[0]!, { problems });
      const clean = inputs as EnvEntryInput[];
      const ids = clean.map((c) => `${c.robot}|${c.port}`);
      if (new Set(ids).size !== ids.length) throw new AppError(400, "VALIDATION_FAILED", "Each port can only be updated once per save.");
      const at = new Date().toISOString();
      const who = actor ? { by: actor } : {};
      const message = commitMessage(clean, actor);

      for (let attempt = 1; ; attempt++) {
        const latest = await this.load();
        const ports = { ...latest.doc.ports };
        const setup = { ...(latest.doc.setup ?? {}) };
        for (const c of clean) {
          if (c.status) {
            // OK is a plain comment: no issue type is stored for it.
            const entry: EnvEntry = {
              at,
              ...who,
              status: c.status,
              ...(c.status !== "ok" && c.category ? { category: c.category } : {}),
              note: (c.note ?? "").trim(),
            };
            const robotPorts = { ...(ports[c.robot] ?? {}) };
            robotPorts[c.port] = [...(robotPorts[c.port] ?? []), entry];
            ports[c.robot] = robotPorts;
          }
          if (c.setup !== undefined) {
            const robotSetup = { ...(setup[c.robot] ?? {}) };
            robotSetup[c.port] = [...(robotSetup[c.port] ?? []), { at, ...who, note: c.setup.trim() }];
            setup[c.robot] = robotSetup;
          }
        }
        const doc: EnvironmentDoc = { version: 1, ports, ...(Object.keys(setup).length ? { setup } : {}) };
        try {
          const outcome = await this.store.write(serializeEnvDoc(doc), { message, expectedVersion: latest.version });
          return {
            doc,
            version: outcome.version,
            fetchedAt: new Date().toISOString(),
            commit: { sha: outcome.commitSha, url: outcome.commitUrl, message: message.split("\n")[0]! },
          };
        } catch (error) {
          const retryable = error instanceof AppError && (error.code === "GITHUB_SHA_CONFLICT" || error.code === "FILE_EXISTS");
          if (retryable && attempt < MAX_WRITE_ATTEMPTS) continue;
          throw error;
        }
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
