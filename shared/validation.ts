import { buildDeviceId, parseDeviceId, PORT_PATTERN, SEGMENT_PATTERN } from "./deviceId";
import { RECORD_FIELDS, type DeviceData, type DeviceRecord, type RecordField } from "./types";

export const MAX_VALUE_LENGTH = 200;
export const MAX_KEY_LENGTH = 300;

export type FieldErrors = Partial<Record<RecordField, string>>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validates a single field value. Values are never trimmed or altered — only checked. */
export function validateFieldValue(value: unknown): string | null {
  if (typeof value !== "string") return "Must be a text value";
  if (value.trim() === "") return "Required";
  if (value !== value.trim()) return "Remove leading or trailing spaces";
  if (value.length > MAX_VALUE_LENGTH) return `Must be at most ${MAX_VALUE_LENGTH} characters`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return "Must not contain control characters";
  return null;
}

export function validateRecordValues(values: Partial<Record<RecordField, unknown>>): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of RECORD_FIELDS) {
    const error = validateFieldValue(values[field]);
    if (error) errors[field] = error;
  }
  return errors;
}

/**
 * Structural check for one record: exactly the six properties, all strings.
 * Returns human-readable problems; empty array means valid.
 */
export function validateRecordShape(value: unknown, label = "Record"): string[] {
  if (!isPlainObject(value)) return [`${label}: must be an object with the six device properties`];
  const problems: string[] = [];
  for (const field of RECORD_FIELDS) {
    if (!(field in value)) problems.push(`${label}: missing property "${field}"`);
    else if (typeof value[field] !== "string") problems.push(`${label}: "${field}" must be a string`);
  }
  for (const prop of Object.keys(value)) {
    if (!(RECORD_FIELDS as readonly string[]).includes(prop)) {
      problems.push(`${label}: unexpected property "${prop}"`);
    }
  }
  return problems;
}

export type DataValidation =
  | { ok: true; data: DeviceData }
  | { ok: false; errors: string[] };

/** Validates the whole deviceInformation.json structure. */
export function validateDeviceData(value: unknown): DataValidation {
  if (!isPlainObject(value)) {
    return { ok: false, errors: ["The root of the JSON must be an object keyed by device identifier"] };
  }
  const errors: string[] = [];
  for (const [key, record] of Object.entries(value)) {
    if (key.trim() === "") errors.push("A record has an empty device identifier");
    errors.push(...validateRecordShape(record, `"${key}"`));
  }
  return errors.length ? { ok: false, errors } : { ok: true, data: value as DeviceData };
}

export interface NewKeyInput {
  device: string;
  port: string;
  suffix: string;
}

export type KeyErrors = Partial<Record<keyof NewKeyInput | "key", string>>;

/** Validates the parts of a new device identifier and that the result round-trips through the parser. */
export function validateNewKeyParts(input: NewKeyInput, existing: DeviceData): KeyErrors {
  const errors: KeyErrors = {};
  const device = input.device;
  const port = input.port;
  const suffix = input.suffix;

  if (!device) errors.device = "Device is required";
  else if (!SEGMENT_PATTERN.test(device)) errors.device = "Use letters, digits, _ & . + separated by single hyphens";
  else if (/-PORT\d+(-|$)/i.test(device)) errors.device = "Device must not contain a PORT segment";

  if (!port) errors.port = "Port is required";
  else if (!PORT_PATTERN.test(port)) errors.port = "Port must look like PORT1, PORT2, …";

  if (!suffix) errors.suffix = "Remaining identifier segments are required";
  else if (!SEGMENT_PATTERN.test(suffix)) errors.suffix = "Use letters, digits, _ & . + separated by single hyphens";

  if (Object.keys(errors).length) return errors;

  const key = buildDeviceId(device, port, suffix);
  const parsed = parseDeviceId(key);
  if (!parsed || parsed.device !== device || parsed.port !== port) {
    errors.key = "This identifier would not be read back as the same device and port";
  } else if (key.length > MAX_KEY_LENGTH) {
    errors.key = `Identifier must be at most ${MAX_KEY_LENGTH} characters`;
  } else if (Object.prototype.hasOwnProperty.call(existing, key)) {
    errors.key = "A record with this exact identifier already exists — it will not be overwritten";
  }
  return errors;
}

/** Copies only the six known fields, in canonical order. */
export function pickRecord(values: Partial<Record<RecordField, string>>): DeviceRecord {
  const record = {} as DeviceRecord;
  for (const field of RECORD_FIELDS) record[field] = values[field] ?? "";
  return record;
}

export function recordsEqual(a: DeviceRecord | undefined, b: DeviceRecord | undefined): boolean {
  if (!a || !b) return a === b;
  return RECORD_FIELDS.every((field) => a[field] === b[field]);
}

export function changedFields(before: DeviceRecord, after: DeviceRecord): RecordField[] {
  return RECORD_FIELDS.filter((field) => before[field] !== after[field]);
}
