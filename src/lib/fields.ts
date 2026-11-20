import type { RecordField } from "../../shared/types";

/**
 * Display name for a record field. The JSON keys never change; only what the UI shows does
 * (e.g. the "Hardware" key is shown as "Platform").
 */
const DISPLAY: Partial<Record<RecordField, string>> = { Hardware: "Platform" };

export function fieldLabel(field: RecordField): string {
  return DISPLAY[field] ?? field;
}
