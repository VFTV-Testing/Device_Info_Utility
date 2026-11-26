import { STB_SCHEMA, type FamilySchema } from "./schema";

/**
 * The device families' rules and where each file lives in the Configs repository.
 * Shared by the site (src/families.ts adds labels and colours) and the sign-in helper,
 * which saves moderator device changes and must check them with the same rules.
 */
export interface FamilyDefinition extends FamilySchema {
  /** Path of the family's deviceInformation.json in the Configs repository. */
  filePath: string;
}

export const FAMILY_DEFINITIONS: readonly FamilyDefinition[] = [
  { ...STB_SCHEMA, filePath: "AVSB_GEN3_Configs/deviceInformation.json" },
  {
    id: "linuxstb",
    // Release → sprintNo, Device Type → Hardware, OPCO_stream → Country.
    fields: ["sprintNo", "Hardware", "Country"],
    // Identifiers are written TES7-GER-STB2-GEN2_PREM-DE_PROD-DVBC: the port is STB1…STB8.
    portPrefixes: ["STB"],
    filePath: "Linux_STB_Configs/deviceInformation.json",
  },
  {
    id: "mobile",
    fields: ["sprintNo", "Cver", "appVersion"],
    portPrefixes: ["PORT"],
    // X103-GER-PORT1-ANDROID-TABLET → Tablet, X110-GER-PORT3-iOS-SMARTPHONE → Phone (shown on the cards).
    deviceKindFromKey: true,
    filePath: "Mobile_Configs/deviceInformation.json",
  },
  {
    id: "smarttv",
    fields: ["sprintNo", "firmwareVersion", "appVersion"],
    // Android, FireOS, Tizen, WebOS… are operating systems, so the platform column is called OS.
    platformLabel: "OS",
    // TV identifiers are written X122-P1-…
    portPrefixes: ["P"],
    filePath: "SmartTV_Configs/deviceInformation.json",
  },
];

export function findFamilyDefinition(id: unknown): FamilyDefinition | undefined {
  return FAMILY_DEFINITIONS.find((f) => f.id === id);
}
