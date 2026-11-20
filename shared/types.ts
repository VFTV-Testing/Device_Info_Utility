/**
 * Data model for deviceInformation.json.
 *
 * The file is a JSON object keyed by the complete device identifier, e.g.
 *   "X101-GER-PORT1-AVSB-FUT_EMMC_Rayson-DE_PROD-DVBC": { sprintNo, Cver, ... }
 *
 * Every record has exactly these six string properties — no more, no fewer.
 */
export const RECORD_FIELDS = [
  "sprintNo",
  "Cver",
  "firmwareVersion",
  "appVersion",
  "Hardware",
  "Country",
] as const;

export type RecordField = (typeof RECORD_FIELDS)[number];

export type DeviceRecord = { [K in RecordField]: string };

/** The whole file: device identifier → record. Insertion order is preserved. */
export type DeviceData = Record<string, DeviceRecord>;

export interface ParsedDeviceId {
  /** Full original key, exactly as stored in the JSON file. */
  key: string;
  /** Prefix before the PORT segment, e.g. "X101-GER". */
  device: string;
  /** Port segment, e.g. "PORT1". */
  port: string;
  portNumber: number;
  /** Everything after the PORT segment, e.g. "AVSB-FUT_EMMC_Rayson-DE_PROD-DVBC". */
  suffix: string;
}

/** Record-level changes sent from the UI to the server. */
export type Mutation =
  | { type: "create"; key: string; values: DeviceRecord }
  /** `base` is the record as the user loaded it — used for conflict detection. */
  | { type: "update"; key: string; base: DeviceRecord; values: DeviceRecord }
  | { type: "delete"; key: string; base: DeviceRecord };

export type ConflictReason = "missing" | "modified" | "exists";

export interface RecordConflict {
  key: string;
  reason: ConflictReason;
  /** The record currently stored in GitHub (absent when reason is "missing"). */
  latest?: DeviceRecord;
}

export interface CommitInfo {
  sha: string;
  url?: string;
  message: string;
}

/** Shape returned by GET /api/devices and by every successful write. */
export interface DevicesSnapshot {
  data: DeviceData;
  /** Opaque version (GitHub blob SHA, or a content hash in local mode). */
  version: string;
  fetchedAt: string;
}

export interface WriteResult extends DevicesSnapshot {
  commit: CommitInfo;
}

export interface AppConfigInfo {
  storage: "github" | "local";
  /** Human-readable location, e.g. "owner/repo@main:deviceInformation.json". */
  location: string;
  repoUrl?: string;
  authEnabled: boolean;
  /** True when the server has no write credentials — saving is disabled. */
  readOnly: boolean;
  /** View-only visitor without a GitHub sign-in (e.g. management). Editing UI is hidden. */
  viewOnly?: boolean;
  user?: string;
}

export type ImportMode = "add-only" | "update-existing";
