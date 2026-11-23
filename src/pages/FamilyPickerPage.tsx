import { motion } from "framer-motion";
import { ArrowRight, Cpu } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { FamilyIcon } from "../components/layout/FamilySwitcher";
import type { DeviceFamily } from "../families";
import { cn } from "../lib/cn";
import { PublicRawFileStore } from "../services/viewerClient";

/** Panel colours (deep → light), the same hues as the family pill. */
const PANEL: Record<DeviceFamily["tone"], [string, string]> = {
  stb: ["#4f46e5", "#818cf8"],
  mobile: ["#059669", "#34d399"],
  tv: ["#d97706", "#fbbf24"],
};

interface Counts {
  devices: number;
  robots: number;
}

/** Device and robot counts per family, read anonymously from the public files. Missing on failure. */
function useFamilyCounts(families: DeviceFamily[]): Record<string, Counts | undefined> {
  const [counts, setCounts] = useState<Record<string, Counts | undefined>>({});
  useEffect(() => {
    let alive = true;
    for (const family of families) {
      new PublicRawFileStore(family.target)
        .read()
        .then((file) => {
          if (!file || !alive) return;
          const keys = Object.keys(JSON.parse(file.text) as object);
          const port = new RegExp(`^(.+?)-(?:${[...family.portPrefixes].sort((a, b) => b.length - a.length).join("|")})\\d+-`);
          const robots = new Set(keys.map((k) => port.exec(k)?.[1]).filter(Boolean));
          setCounts((c) => ({ ...c, [family.id]: { devices: keys.length, robots: robots.size } }));
        })
        .catch(() => {
          /* counts are a nice extra; the picker works without them */
        });
    }
    return () => {
      alive = false;
    };
  }, [families]);
  return counts;
}

/**
 * Asked once, right after the first sign-in (or opening the view): which device family to open.
 * Expanding panels: the hovered family widens to show its details. The choice is remembered;
 * afterwards the family is changed from the pill in the header.
 */
export function FamilyPickerPage({ families, onPick }: { families: DeviceFamily[]; onPick: (family: DeviceFamily) => void }) {
  const [open, setOpen] = useState(families[0]?.id);
  const counts = useFamilyCounts(families);

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-4xl">
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mb-8 flex flex-col items-center gap-3 text-center"
        >
          <span className="grid size-14 place-items-center rounded-2xl bg-[linear-gradient(135deg,#6366f1,#22d3ee)] text-white shadow-[0_10px_30px_var(--primary-glow)]">
            <Cpu className="size-7" aria-hidden />
          </span>
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Which devices do you work on?</h1>
          <p className="text-sm text-fg-muted">You can switch family anytime from the top bar.</p>
        </motion.header>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="fp-panels"
          onMouseLeave={() => setOpen(families[0]?.id)}
        >
          {families.map((family) => {
            const [from, to] = PANEL[family.tone];
            const c = counts[family.id];
            return (
              <button
                key={family.id}
                type="button"
                aria-label={`Open ${family.label}`}
                className={cn("fp-panel", open === family.id && "is-open")}
                style={{ "--fam": from, "--fam-2": to } as CSSProperties}
                onMouseEnter={() => setOpen(family.id)}
                onFocus={() => setOpen(family.id)}
                onClick={() => onPick(family)}
              >
                <span className="fp-icon">
                  <FamilyIcon family={family} className="size-6" />
                </span>
                <span className="fp-vert" aria-hidden>
                  {family.label}
                </span>
                <span className="fp-info">
                  <p>{family.description}</p>
                  <span className="fp-nums">
                    {c && (
                      <>
                        <span>
                          <b>{c.devices}</b>
                          <span>devices</span>
                        </span>
                        <span>
                          <b>{c.robots}</b>
                          <span>robots</span>
                        </span>
                      </>
                    )}
                  </span>
                </span>
                <span className="fp-name">{family.label}</span>
                <span className="fp-go" aria-hidden>
                  <ArrowRight className="size-5" />
                </span>
              </button>
            );
          })}
        </motion.div>
      </div>
    </div>
  );
}
