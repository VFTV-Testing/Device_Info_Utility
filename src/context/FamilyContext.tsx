import { createContext, useContext } from "react";
import type { DeviceFamily } from "../families";

export interface FamilyValue {
  /** The device family on screen (its file, fields and port format). */
  family: DeviceFamily;
  families: DeviceFamily[];
  switchTo: (family: DeviceFamily) => void;
}

/** Provided on the browser-only site, where several device families can be opened. */
export const FamilyContext = createContext<FamilyValue | null>(null);

export function useFamily(): FamilyValue | null {
  return useContext(FamilyContext);
}

/**
 * Set just before the app reloads for another family, so the new page can fade in from a blur
 * (a normal launch shows the page straight away, with its own entrance animations).
 */
let switchPending = false;
export function noteFamilySwitch(): void {
  switchPending = true;
}
export function familySwitchPending(): boolean {
  return switchPending;
}
export function clearFamilySwitch(): void {
  switchPending = false;
}
