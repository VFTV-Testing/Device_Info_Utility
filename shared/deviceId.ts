import type { DeviceData, ParsedDeviceId } from "./types";

/**
 * Device identifiers look like  <device>-PORT<n>-<suffix>
 *   X101-GER-PORT1-AVSB-FUT_EMMC_Rayson-DE_PROD-DVBC
 *   └device─┘└port┘└──────────suffix──────────────┘
 *
 * The lazy prefix match picks the FIRST "-PORT<n>-" segment, so suffixes may
 * contain anything (including "PORT" text) without confusing the parser.
 */
const DEVICE_ID_PATTERN = /^(.+?)-(PORT(\d+))-(.+)$/;

export const PORT_PATTERN = /^PORT[1-9]\d*$/;

/** Characters allowed in device prefixes and suffix segments (matches existing data, e.g. "Ray&Fore"). */
export const SEGMENT_PATTERN = /^[A-Za-z0-9_&.+]+(?:-[A-Za-z0-9_&.+]+)*$/;

export function parseDeviceId(key: string): ParsedDeviceId | null {
  if (typeof key !== "string") return null;
  const match = DEVICE_ID_PATTERN.exec(key);
  if (!match) return null;
  const [, device, port, digits, suffix] = match;
  if (!device || !port || !digits || !suffix) return null;
  return { key, device, port, portNumber: Number(digits), suffix };
}

export function buildDeviceId(device: string, port: string, suffix: string): string {
  return `${device}-${port}-${suffix}`;
}

/** Normalises user input like "1", "port1" or "PORT01" to "PORT1". Returns null if it is not a port. */
export function normalizePort(input: string): string | null {
  const match = /^(?:port)?\s*0*([1-9]\d*)$/i.exec(input.trim());
  return match ? `PORT${match[1]}` : null;
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Natural sort: PORT2 < PORT10, X101 < X1010. */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

export interface DeviceIndex {
  parsed: ParsedDeviceId[];
  /** Keys that do not follow the <device>-PORT<n>-<suffix> convention. */
  unparsed: string[];
  devices: string[];
  portsByDevice: Map<string, string[]>;
}

/** Builds the dropdown options from the actual keys in the JSON — nothing is hard-coded. */
export function buildDeviceIndex(data: DeviceData): DeviceIndex {
  const parsed: ParsedDeviceId[] = [];
  const unparsed: string[] = [];
  const ports = new Map<string, Set<string>>();

  for (const key of Object.keys(data)) {
    const id = parseDeviceId(key);
    if (!id) {
      unparsed.push(key);
      continue;
    }
    parsed.push(id);
    let set = ports.get(id.device);
    if (!set) ports.set(id.device, (set = new Set()));
    set.add(id.port);
  }

  const devices = [...ports.keys()].sort(naturalCompare);
  const portsByDevice = new Map<string, string[]>();
  for (const device of devices) {
    portsByDevice.set(device, [...(ports.get(device) ?? [])].sort(naturalCompare));
  }
  return { parsed, unparsed, devices, portsByDevice };
}

export function getPortsForDevice(index: DeviceIndex, device: string | null | undefined): string[] {
  if (!device) return [];
  return index.portsByDevice.get(device) ?? [];
}

/**
 * Finds every original key whose device AND port match exactly.
 * Never reconstructs a key — callers always get keys straight from the data.
 */
export function findMatchingKeys(index: DeviceIndex, device: string, port: string): string[] {
  return index.parsed
    .filter((id) => id.device === device && id.port === port)
    .map((id) => id.key);
}

export type MatchResult =
  | { kind: "none" }
  | { kind: "single"; key: string }
  | { kind: "multiple"; keys: string[] };

export function resolveMatch(index: DeviceIndex, device: string, port: string): MatchResult {
  const keys = findMatchingKeys(index, device, port);
  if (keys.length === 0) return { kind: "none" };
  if (keys.length === 1) return { kind: "single", key: keys[0]! };
  return { kind: "multiple", keys };
}
