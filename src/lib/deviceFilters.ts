import { parseDeviceId } from "../../shared/deviceId";
import type { DeviceData, DeviceRecord } from "../../shared/types";

/**
 * Filtering shared by All Devices and the JSON preview, so "JSON for these filters"
 * always shows exactly the records the user is looking at.
 */
export interface Row extends DeviceRecord {
  key: string;
  /** Robot, e.g. "X101-GER". */
  device: string;
  /** Device port, e.g. "PORT1". */
  port: string;
  /** Country code from the Country field, e.g. "DE" from "DE_DVBC". */
  country: string;
  /** Stream type from the Country field, e.g. "DVBC" from "DE_DVBC". */
  service: string;
}

export type FilterName = "device" | "Hardware" | "country" | "service" | "sprintNo" | "appVersion" | "firmwareVersion";
export type Filters = Record<FilterName, string[]>;

export const FILTER_LABELS: Record<FilterName, string> = {
  device: "Robot",
  Hardware: "Platform",
  country: "Country",
  service: "Stream type",
  sprintNo: "sprintNo",
  appVersion: "appVersion",
  firmwareVersion: "firmwareVersion",
};
export const FILTER_NAMES = Object.keys(FILTER_LABELS) as FilterName[];
export const EMPTY_FILTERS = Object.fromEntries(FILTER_NAMES.map((n) => [n, []])) as unknown as Filters;

/** Friendly names for the country codes used in the Country field (unknown codes show as-is). */
export const COUNTRY_NAMES: Record<string, string> = {
  AL: "Albania",
  CZ: "Czechia",
  DE: "Germany",
  ES: "Spain",
  GB: "United Kingdom",
  GR: "Greece",
  HU: "Hungary",
  IE: "Ireland",
  IT: "Italy",
  NL: "Netherlands",
  PT: "Portugal",
  RO: "Romania",
  TR: "Türkiye",
  UK: "United Kingdom",
};

/** "DE_DVBC" → { country: "DE", service: "DVBC" }; a value without "_" is all country. */
export function splitCountry(value: string): { country: string; service: string } {
  const i = value.indexOf("_");
  return i < 0 ? { country: value, service: "—" } : { country: value.slice(0, i), service: value.slice(i + 1) };
}

export function buildRows(data: DeviceData): Row[] {
  return Object.entries(data).map(([key, record]) => {
    const id = parseDeviceId(key);
    return { key, device: id?.device ?? "—", port: id?.port ?? "—", ...record, ...splitCountry(record.Country) };
  });
}

/** Returns a predicate for rows matching every non-empty filter and the free-text search. */
export function rowMatcher(filters: Filters, query: string): (row: Row) => boolean {
  const search = query.trim().toLowerCase();
  const sets = FILTER_NAMES.map((name) => [name, new Set(filters[name] ?? [])] as const).filter(([, set]) => set.size > 0);
  return (row) => {
    for (const [name, set] of sets) if (!set.has(row[name])) return false;
    if (!search) return true;
    return [row.key, row.sprintNo, row.Cver, row.firmwareVersion, row.appVersion, row.Hardware, row.Country].some((v) =>
      v.toLowerCase().includes(search),
    );
  };
}

export function hasActiveFilters(filters: Filters, query: string): boolean {
  return query.trim() !== "" || FILTER_NAMES.some((n) => (filters[n] ?? []).length > 0);
}

/** "Robot: X101-GER, X102-GER · Platform: GEN3 · Search: “0.67”" */
export function describeFilters(filters: Filters, query: string): string {
  const parts = FILTER_NAMES.filter((n) => (filters[n] ?? []).length).map((n) => `${FILTER_LABELS[n]}: ${filters[n].join(", ")}`);
  if (query.trim()) parts.push(`Search: “${query.trim()}”`);
  return parts.join(" · ");
}

/** The subset of the file the filters match, keeping the file's own record order. */
export function filterData(data: DeviceData, filters: Filters, query: string): DeviceData {
  const match = rowMatcher(filters, query);
  const result: DeviceData = {};
  for (const row of buildRows(data)) if (match(row)) result[row.key] = data[row.key]!;
  return result;
}

// Filters survive moving to the JSON page and back (per tab, like the view choice).
const FILTER_STATE_KEY = "dim-device-filters";

export interface FilterState {
  filters: Filters;
  query: string;
}

export function loadFilterState(): FilterState {
  try {
    const raw = sessionStorage.getItem(FILTER_STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FilterState>;
      const filters = { ...EMPTY_FILTERS };
      for (const n of FILTER_NAMES) {
        const v = parsed.filters?.[n];
        if (Array.isArray(v)) filters[n] = v.filter((x): x is string => typeof x === "string");
      }
      return { filters, query: typeof parsed.query === "string" ? parsed.query : "" };
    }
  } catch {
    /* unreadable or unavailable storage — start clean */
  }
  return { filters: EMPTY_FILTERS, query: "" };
}

export function saveFilterState(state: FilterState): void {
  try {
    sessionStorage.setItem(FILTER_STATE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — filters just won't be remembered */
  }
}
