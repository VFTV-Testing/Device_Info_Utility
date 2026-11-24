/** Marks a device used for ATP (identifier tagged "_ATP", e.g. TES9-GER-STB6-GEN2_PREM-DE_ATP-DVBC). */
export function AtpBadge() {
  return (
    <span
      title="ATP device"
      className="inline-flex items-center rounded-full bg-[var(--hw-4-soft)] px-1.5 py-px align-middle text-[9px] font-bold uppercase tracking-wide text-[var(--hw-4-fg)] ring-1 ring-[var(--hw-4)]/40"
    >
      ATP
    </span>
  );
}
