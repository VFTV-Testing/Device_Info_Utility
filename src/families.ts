import { FAMILY_DEFINITIONS } from "../shared/familySchemas";
import type { FamilySchema } from "../shared/schema";
import { DATA_MODE, GITHUB_TARGET, type GitHubTarget } from "./config";

/**
 * Device families. Each keeps its own deviceInformation.json (same repository and branch,
 * its own folder) with its own fields, and the user switches between them from the header.
 * Everything here is public — no secrets.
 */
export interface DeviceFamily extends FamilySchema {
  label: string;
  /** One line shown under the family name in the header menu. */
  description: string;
  /** Badge colour (mapped to the platform palette in FamilySwitcher). */
  tone: "stb" | "linux" | "mobile" | "tv";
  target: GitHubTarget;
}

/** Labels and colours for the shared family rules (shared/familySchemas.ts). */
const LOOKS: Record<string, Pick<DeviceFamily, "label" | "description" | "tone">> = {
  stb: { label: "Android STB", description: "Android set-top boxes", tone: "stb" },
  linuxstb: { label: "Linux STB", description: "Linux set-top boxes on the TES robots", tone: "linux" },
  mobile: { label: "Mobile", description: "Android and iOS phones and tablets", tone: "mobile" },
  smarttv: { label: "Smart TV", description: "Smart TVs and streaming sticks", tone: "tv" },
};

export const ALL_FAMILIES: DeviceFamily[] = FAMILY_DEFINITIONS.map(({ filePath, ...schema }) => ({
  ...schema,
  ...LOOKS[schema.id]!,
  // Android STB keeps the file configured for the site (.env.pages); the others sit beside it.
  target: schema.id === "stb" ? GITHUB_TARGET : { ...GITHUB_TARGET, filePath },
}));

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
