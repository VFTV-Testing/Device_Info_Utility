import { setPortPrefixes } from "./deviceId";
import { ALL_RECORD_FIELDS, RECORD_FIELDS, type RecordField } from "./types";

/**
 * What differs between device families (STB, Mobile, Smart TV…): the fields each record has
 * and how ports are written in the device identifier. Each family keeps its own
 * deviceInformation.json; only one family is open at a time.
 */
export interface FamilySchema {
  id: string;
  /** The record fields, in file order. */
  fields: readonly RecordField[];
  /** Port spellings, e.g. ["PORT"] or ["P", "PORT"]; the first is used for new devices. */
  portPrefixes: readonly string[];
}

/** The original STB family: all six fields, ports written PORT1, PORT2, … */
export const STB_SCHEMA: FamilySchema = { id: "stb", fields: ALL_RECORD_FIELDS, portPrefixes: ["PORT"] };

let active: FamilySchema = STB_SCHEMA;

/**
 * Opens a family: from now on the validators, forms and tables use its fields and port rules.
 * The server and the sign-in helper never call this, so they always use the STB schema.
 */
export function setActiveSchema(schema: FamilySchema): void {
  if (active === schema) return;
  active = schema;
  RECORD_FIELDS.splice(0, RECORD_FIELDS.length, ...schema.fields);
  setPortPrefixes(schema.portPrefixes);
}

export function activeSchema(): FamilySchema {
  return active;
}

/** True when the open family's records have this field. */
export function hasField(field: RecordField): boolean {
  return RECORD_FIELDS.includes(field);
}
