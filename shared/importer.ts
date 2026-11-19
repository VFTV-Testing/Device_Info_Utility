import { parseDeviceId } from "./deviceId";
import { changedFields, pickRecord, recordsEqual, validateRecordShape, validateRecordValues } from "./validation";
import type { DeviceData, DeviceRecord, ImportMode, Mutation, RecordField } from "./types";

/**
 * JSON.parse silently keeps only the last of duplicate keys, so we scan the raw
 * text for duplicate keys in the root object before parsing.
 */
export function findDuplicateRootKeys(text: string): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  let depth = 0;
  let i = 0;
  let expectKey = false;

  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"') {
      // read the string literal
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      const literal = text.slice(i, j + 1);
      if (depth === 1 && expectKey) {
        let key: string;
        try {
          key = JSON.parse(literal) as string;
        } catch {
          key = literal;
        }
        if (seen.has(key)) duplicates.add(key);
        seen.add(key);
        expectKey = false;
      }
      i = j + 1;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth++;
      if (depth === 1 && ch === "{") expectKey = true;
    } else if (ch === "}" || ch === "]") {
      depth--;
    } else if (ch === "," && depth === 1) {
      expectKey = true;
    }
    i++;
  }
  return [...duplicates];
}

export interface ImportChange {
  key: string;
  before: DeviceRecord;
  after: DeviceRecord;
  fields: RecordField[];
}

export interface ImportAnalysis {
  /** Fatal problems — nothing can be imported while any exist. */
  errors: string[];
  /** Non-fatal notes, e.g. identifiers that do not follow the naming convention. */
  warnings: string[];
  records: DeviceData;
  newKeys: string[];
  changed: ImportChange[];
  unchanged: string[];
}

/** Parses and validates an uploaded JSON file and compares it with the current data. */
export function analyzeImport(text: string, existing: DeviceData): ImportAnalysis {
  const empty: ImportAnalysis = { errors: [], warnings: [], records: {}, newKeys: [], changed: [], unchanged: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ...empty, errors: [`Invalid JSON: ${(error as Error).message}`] };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ...empty, errors: ["The file must contain a JSON object keyed by device identifier (not an array)"] };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  for (const key of findDuplicateRootKeys(text)) errors.push(`Duplicate device identifier in file: "${key}"`);

  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0) errors.push("The file does not contain any records");

  const records: DeviceData = {};
  for (const [key, value] of entries) {
    if (key.trim() === "") {
      errors.push("A record has an empty device identifier");
      continue;
    }
    const shapeProblems = validateRecordShape(value, `"${key}"`);
    if (shapeProblems.length) {
      errors.push(...shapeProblems);
      continue;
    }
    const valueProblems = validateRecordValues(value as DeviceRecord);
    for (const [field, message] of Object.entries(valueProblems)) errors.push(`"${key}": ${field} — ${message}`);
    if (!parseDeviceId(key)) warnings.push(`"${key}" does not follow the <device>-PORT<n>-<rest> naming convention`);
    records[key] = pickRecord(value as DeviceRecord);
  }

  const newKeys: string[] = [];
  const changed: ImportChange[] = [];
  const unchanged: string[] = [];
  for (const [key, record] of Object.entries(records)) {
    const current = existing[key];
    if (!current) newKeys.push(key);
    else if (recordsEqual(current, record)) unchanged.push(key);
    else changed.push({ key, before: current, after: record, fields: changedFields(current, record) });
  }

  return { errors, warnings, records, newKeys, changed, unchanged };
}

/** Turns an analysis into mutations. Add-only never produces updates. */
export function buildImportMutations(analysis: ImportAnalysis, mode: ImportMode): Mutation[] {
  const mutations: Mutation[] = analysis.newKeys.map((key) => ({
    type: "create",
    key,
    values: analysis.records[key]!,
  }));
  if (mode === "update-existing") {
    for (const change of analysis.changed) {
      mutations.push({ type: "update", key: change.key, base: change.before, values: change.after });
    }
  }
  return mutations;
}
