import type { CSSProperties } from "react";
import { naturalCompare } from "../../shared/deviceId";

const PALETTE_SIZE = 5;

export interface HardwareTone {
  /** Solid colour (bars, dots). */
  solid: string;
  /** Tinted background for chips and tiles. */
  soft: string;
  /** Readable text colour on the soft background. */
  fg: string;
}

/**
 * Stable colour per hardware type: types are sorted, then take palette slots in order,
 * so AVSB is always the same colour no matter which page or filter shows it.
 */
export function hardwareTones(hardware: Iterable<string>): Map<string, HardwareTone> {
  const sorted = [...new Set(hardware)].sort(naturalCompare);
  const tones = new Map<string, HardwareTone>();
  sorted.forEach((name, i) => {
    const slot = (i % PALETTE_SIZE) + 1;
    tones.set(name, { solid: `var(--hw-${slot})`, soft: `var(--hw-${slot}-soft)`, fg: `var(--hw-${slot}-fg)` });
  });
  return tones;
}

const FALLBACK: HardwareTone = { solid: "var(--fg-subtle)", soft: "var(--surface-2)", fg: "var(--fg-muted)" };

export function chipStyle(tone: HardwareTone | undefined): CSSProperties {
  const t = tone ?? FALLBACK;
  return { backgroundColor: t.soft, color: t.fg };
}

export function toneOf(tones: Map<string, HardwareTone>, hardware: string): HardwareTone {
  return tones.get(hardware) ?? FALLBACK;
}
