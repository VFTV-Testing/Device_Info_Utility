import { STB_SCHEMA, type FamilySchema } from "../shared/schema";
import { DATA_MODE, GITHUB_TARGET, type GitHubTarget } from "./config";

/**
 * Device families. Each keeps its own deviceInformation.json (same repository and branch,
 * its own folder) with its own fields, and the user switches between them from the header.
 * Everything here is public — no secrets.
 */
export interface DeviceFamily extends FamilySchema {
  label: string;
  /** One line shown in the family picker. */
  description: string;
  /** Badge colour (mapped to the platform palette in FamilySwitcher). */
  tone: "stb" | "mobile" | "tv";
  target: GitHubTarget;
}

export const ALL_FAMILIES: DeviceFamily[] = [
  {
    ...STB_SCHEMA,
    label: "STB",
    description: "Set-top boxes",
    tone: "stb",
    target: GITHUB_TARGET,
  },
  {
    id: "mobile",
    label: "Mobile",
    description: "Android and iOS phones and tablets",
    tone: "mobile",
    fields: ["sprintNo", "Cver", "appVersion"],
    portPrefixes: ["PORT"],
    target: { ...GITHUB_TARGET, filePath: "Mobile_Configs/deviceInformation.json" },
  },
  {
    id: "smarttv",
    label: "Smart TV",
    description: "Smart TVs and streaming sticks",
    tone: "tv",
    fields: ["sprintNo", "Cver", "firmwareVersion"],
    // TV identifiers are written X122-P1-…
    portPrefixes: ["P"],
    target: { ...GITHUB_TARGET, filePath: "SmartTV_Configs/deviceInformation.json" },
  },
];

/** The Node server serves one file (STB); the family switcher is for the browser-only site. */
export const FAMILIES: DeviceFamily[] = DATA_MODE === "github-direct" ? ALL_FAMILIES : ALL_FAMILIES.slice(0, 1);

export function findFamily(id: string | null | undefined, families: DeviceFamily[] = FAMILIES): DeviceFamily | undefined {
  return families.find((f) => f.id === id);
}

const FAMILY_KEY = "dim-family";
const FAMILY_PARAM = "family";

/** "?family=mobile" in a shared link wins over the family remembered in this browser. */
export function readFamilyChoice(families: DeviceFamily[] = FAMILIES): DeviceFamily | null {
  if (families.length === 1) return families[0]!;
  try {
    const fromLink = findFamily(new URLSearchParams(window.location.search).get(FAMILY_PARAM)?.toLowerCase(), families);
    if (fromLink) return fromLink;
    return findFamily(localStorage.getItem(FAMILY_KEY), families) ?? null;
  } catch {
    return null;
  }
}

/** Remembers the family in this browser and puts it in the address, so a copied link opens it. */
export function rememberFamily(family: DeviceFamily): void {
  try {
    localStorage.setItem(FAMILY_KEY, family.id);
  } catch {
    /* storage unavailable — the choice lasts until the page is closed */
  }
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get(FAMILY_PARAM) !== family.id) {
      url.searchParams.set(FAMILY_PARAM, family.id);
      // "?view" has no value; keep it bare instead of "view=".
      window.history.replaceState(null, "", url.toString().replace(/([?&]view)=(?=&|#|$)/i, "$1"));
    }
  } catch {
    /* address cannot be changed (e.g. sandboxed) — not important */
  }
}
