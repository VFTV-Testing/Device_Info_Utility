import * as Popover from "@radix-ui/react-popover";
import { motion } from "framer-motion";
import { Check, ChevronDown, Smartphone, Tv, type LucideIcon } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { noteFamilySwitch, useFamily } from "../../context/FamilyContext";
import type { DeviceFamily } from "../../families";
import { cn } from "../../lib/cn";

/** Set-top box glyph (lucide has none). */
function BoxIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="2" y="8" width="20" height="9" rx="2" />
      <path d="M6 12.5h.01M10 12.5h.01M15 12.5h3" />
    </svg>
  );
}

const ICONS: Record<DeviceFamily["tone"], LucideIcon | typeof BoxIcon> = { stb: BoxIcon, mobile: Smartphone, tv: Tv };
const SLOTS: Record<DeviceFamily["tone"], number> = { stb: 1, mobile: 5, tv: 4 };

/** The family's colours, taken from the platform palette so they work in light and dark. */
export function familyStyle(family: DeviceFamily): CSSProperties {
  const slot = SLOTS[family.tone];
  return { "--fam": `var(--hw-${slot})`, "--fam-soft": `var(--hw-${slot}-soft)`, "--fam-fg": `var(--hw-${slot}-fg)` } as CSSProperties;
}

export function FamilyIcon({ family, className }: { family: DeviceFamily; className?: string }) {
  const Icon = ICONS[family.tone];
  return <Icon className={className} aria-hidden />;
}

/** Blurs the page out before the family changes (skipped when motion is reduced or unsupported). */
function leavePage(then: () => void) {
  const main = document.querySelector("main");
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!main || reduce || typeof main.animate !== "function") return then();
  main
    .animate([{ opacity: 1, filter: "blur(0px)" }, { opacity: 0.25, filter: "blur(6px)" }], { duration: 220, easing: "ease-in", fill: "forwards" })
    .finished.then(then, then);
}

/**
 * The coloured family pill in the header. Opens a menu to switch to another device family;
 * `confirmLeave` lets the page ask first when there are unsaved edits.
 */
export function FamilySwitcher({ confirmLeave }: { confirmLeave?: () => boolean }) {
  const ctx = useFamily();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  if (!ctx || ctx.families.length < 2) return null;
  const { family, families, switchTo } = ctx;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setHovered(null);
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Device family: ${family.label}. Change family`}
          style={familyStyle(family)}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-[var(--fam-soft)] pl-1 pr-2.5 text-xs font-semibold text-[var(--fam-fg)] transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          {/* Keyed by family: the icon flips in each time the family changes. */}
          <span key={family.id} className="fam-flip grid size-6 place-items-center rounded-full bg-[var(--fam)] text-white">
            <FamilyIcon family={family} className="size-3.5" />
          </span>
          {family.label}
          <ChevronDown className={cn("size-3.5 opacity-70 transition-transform duration-300", open && "rotate-180")} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={8} className="z-50 w-72" asChild>
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformOrigin: "top left" }}
            className="rounded-2xl border border-border bg-surface p-1.5 shadow-2xl"
            role="menu"
            aria-label="Device families"
            onMouseLeave={() => setHovered(null)}
          >
            <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Device family</p>
            {families.map((f, i) => {
              const current = f.id === family.id;
              return (
                <motion.button
                  key={f.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={current}
                  style={familyStyle(f)}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.05 + i * 0.045, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  onMouseEnter={() => setHovered(f.id)}
                  onFocus={() => setHovered(f.id)}
                  onClick={() => {
                    setOpen(false);
                    if (!current && (!confirmLeave || confirmLeave())) {
                      noteFamilySwitch();
                      leavePage(() => switchTo(f));
                    }
                  }}
                  className="relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left focus-visible:outline-none"
                >
                  {/* One highlight that glides to whichever row is under the pointer. */}
                  {(hovered ?? family.id) === f.id && (
                    <motion.span layoutId="family-row-highlight" className="absolute inset-0 rounded-xl bg-surface-2" transition={{ type: "spring", stiffness: 500, damping: 40 }} />
                  )}
                  <span className="relative grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--fam)] text-white">
                    <FamilyIcon family={f} className="size-4" />
                  </span>
                  <span className="relative min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-fg">{f.label}</span>
                    <span className="block truncate text-[11px] text-fg-muted">{f.description}</span>
                  </span>
                  {current && <Check className="relative size-4 shrink-0 text-accent" aria-hidden />}
                </motion.button>
              );
            })}
          </motion.div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
