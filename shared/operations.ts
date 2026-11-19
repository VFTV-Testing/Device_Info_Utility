import { naturalCompare } from "./deviceId";
import { pickRecord, recordsEqual, validateRecordValues } from "./validation";
import { RECORD_FIELDS, type DeviceData, type DeviceRecord, type Mutation, type RecordConflict } from "./types";

export interface ApplyResult {
  data: DeviceData;
  conflicts: RecordConflict[];
  /** Number of records actually changed (no-ops are not counted). */
  changed: number;
}

/**
 * Inserts a new key at its natural-sort position WITHOUT reordering existing keys.
 * Existing records keep their exact order, so the Git diff only shows the new lines.
 */
export function insertKeyInOrder(data: DeviceData, key: string, record: DeviceRecord): DeviceData {
  const result: DeviceData = {};
  let inserted = false;
  for (const [existingKey, value] of Object.entries(data)) {
    if (!inserted && naturalCompare(key, existingKey) < 0) {
      result[key] = record;
      inserted = true;
    }
    result[existingKey] = value;
  }
  if (!inserted) result[key] = record;
  return result;
}

/** Updates values in place, preserving the record's existing property order. */
function mergeRecord(existing: DeviceRecord, values: DeviceRecord): DeviceRecord {
  const merged = { ...existing };
  for (const field of RECORD_FIELDS) merged[field] = values[field];
  return merged;
}

/**
 * Applies record-level mutations to the LATEST data from GitHub.
 *
 * Conflict rules (nothing is applied if any conflict is found — all or nothing):
 *  - create: key must not already exist.
 *  - update: key must exist and still equal the version the user loaded (`base`).
 *            If someone already saved exactly the same values, it is a no-op, not a conflict.
 *  - delete: key must exist and still equal `base`.
 * Records not named in a mutation are never touched.
 */
export function applyMutations(latest: DeviceData, mutations: Mutation[]): ApplyResult {
  const conflicts: RecordConflict[] = [];
  let data: DeviceData = { ...latest };
  let changed = 0;

  for (const mutation of mutations) {
    const has = Object.prototype.hasOwnProperty.call(data, mutation.key);
    const current = has ? data[mutation.key] : undefined;

    switch (mutation.type) {
      case "create": {
        if (current) {
          conflicts.push({ key: mutation.key, reason: "exists", latest: current });
          break;
        }
        data = insertKeyInOrder(data, mutation.key, pickRecord(mutation.values));
        changed++;
        break;
      }
      case "update": {
        if (!current) {
          conflicts.push({ key: mutation.key, reason: "missing" });
          break;
        }
        if (recordsEqual(current, mutation.values)) break; // already up to date
        if (!recordsEqual(current, mutation.base)) {
          conflicts.push({ key: mutation.key, reason: "modified", latest: current });
          break;
        }
        data[mutation.key] = mergeRecord(current, mutation.values);
        changed++;
        break;
      }
      case "delete": {
        if (!current) {
          conflicts.push({ key: mutation.key, reason: "missing" });
          break;
        }
        if (!recordsEqual(current, mutation.base)) {
          conflicts.push({ key: mutation.key, reason: "modified", latest: current });
          break;
        }
        delete data[mutation.key];
        changed++;
        break;
      }
    }
  }

  return conflicts.length ? { data: latest, conflicts, changed: 0 } : { data, conflicts, changed };
}

/** Validates the payload of every mutation (shape and values). Returns problems, empty when valid. */
export function validateMutations(mutations: unknown): string[] {
  if (!Array.isArray(mutations) || mutations.length === 0) return ["No changes were provided"];
  const problems: string[] = [];
  const seen = new Set<string>();
  mutations.forEach((m: unknown, i) => {
    const label = `Change #${i + 1}`;
    if (typeof m !== "object" || m === null) {
      problems.push(`${label}: invalid`);
      return;
    }
    const mutation = m as Record<string, unknown>;
    const key = mutation.key;
    if (typeof key !== "string" || key.trim() === "") {
      problems.push(`${label}: missing device identifier`);
      return;
    }
    if (seen.has(key)) problems.push(`${label}: "${key}" appears more than once`);
    seen.add(key);

    const checkRecord = (value: unknown, what: string) => {
      if (typeof value !== "object" || value === null) {
        problems.push(`${label} (${key}): ${what} is missing`);
        return;
      }
      const errors = validateRecordValues(value as Record<string, unknown>);
      for (const [field, message] of Object.entries(errors)) problems.push(`${label} (${key}): ${field} — ${message}`);
    };
    const checkBase = (value: unknown) => {
      if (typeof value !== "object" || value === null) {
        problems.push(`${label} (${key}): the original values are missing`);
        return;
      }
      for (const field of RECORD_FIELDS) {
        if (typeof (value as Record<string, unknown>)[field] !== "string") {
          problems.push(`${label} (${key}): original "${field}" must be a string`);
        }
      }
    };

    switch (mutation.type) {
      case "create":
        checkRecord(mutation.values, "values");
        break;
      case "update":
        checkRecord(mutation.values, "values");
        checkBase(mutation.base);
        break;
      case "delete":
        checkBase(mutation.base);
        break;
      default:
        problems.push(`${label}: unknown change type`);
    }
  });
  return problems;
}

/** Strips any extra properties a client may have sent; only the six fields survive. */
export function sanitizeMutations(mutations: Mutation[]): Mutation[] {
  return mutations.map((m) => {
    switch (m.type) {
      case "create":
        return { type: "create", key: m.key, values: pickRecord(m.values) };
      case "update":
        return { type: "update", key: m.key, base: pickRecord(m.base), values: pickRecord(m.values) };
      case "delete":
        return { type: "delete", key: m.key, base: pickRecord(m.base) };
    }
  });
}
