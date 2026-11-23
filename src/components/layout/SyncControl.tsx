import * as Popover from "@radix-ui/react-popover";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, CircleDot, Loader2, PencilLine, RefreshCw, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { AUTO_SYNC_OPTIONS, useDeviceData, type SyncLabel } from "../../context/DeviceDataContext";
import { cn, formatTime, timeAgo } from "../../lib/cn";
import { Button } from "../ui/primitives";

const statusStyles: Record<SyncLabel, { tone: string; icon: typeof CheckCircle2; spin?: boolean; showAge?: boolean }> = {
  Connecting: { tone: "text-fg-muted bg-surface-2", icon: Loader2, spin: true },
  Syncing: { tone: "text-accent bg-accent-soft", icon: Loader2, spin: true },
  Connected: { tone: "text-success bg-success-soft", icon: CircleDot, showAge: true },
  "Saved to GitHub": { tone: "text-success bg-success-soft", icon: CheckCircle2 },
  "Saved locally": { tone: "text-success bg-success-soft", icon: CheckCircle2 },
  "Unsaved Changes": { tone: "text-warning bg-warning-soft", icon: PencilLine },
  "Conflict Detected": { tone: "text-danger bg-danger-soft", icon: AlertTriangle },
  "Connection Failed": { tone: "text-danger bg-danger-soft", icon: WifiOff },
  "File Missing": { tone: "text-warning bg-warning-soft", icon: AlertTriangle },
  "Invalid File": { tone: "text-danger bg-danger-soft", icon: AlertTriangle },
};

function intervalLabel(ms: number): string {
  if (ms === 0) return "Off";
  return ms < 60_000 ? `${ms / 1000}s` : `${ms / 60_000}m`;
}

/** Re-renders every few seconds so "12s ago" stays current. */
function useNow(stepMs = 5000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);
  return now;
}

export function SyncControl() {
  const { syncLabel, lastSyncedAt, backgroundSyncing, syncError, autoSyncMs, setAutoSyncMs, refresh, syncing, config } = useDeviceData();
  const now = useNow();
  const style = statusStyles[syncLabel];
  const Icon = backgroundSyncing ? RefreshCw : style.icon;
  const spinning = style.spin || backgroundSyncing;
  const source = config?.storage === "local" ? "the local file" : "GitHub";

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Sync status and settings"
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition hover:brightness-110",
            "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring",
            syncError && !style.spin ? "bg-warning-soft text-warning" : style.tone,
          )}
        >
          <Icon className={cn("size-3.5", spinning && "animate-spin")} aria-hidden />
          <span role="status" aria-live="polite" data-testid="sync-status">
            {syncLabel}
          </span>
          {style.showAge && <span className="hidden opacity-80 sm:inline">· {timeAgo(lastSyncedAt, now)}</span>}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="z-50 w-72" asChild>
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.12 }}
            className="rounded-2xl border border-border bg-surface p-4 text-sm shadow-2xl"
          >
            <p className="font-medium text-fg">Synced with {source}</p>
            <p className="mt-0.5 text-xs text-fg-muted">
              Last sync {formatTime(lastSyncedAt)} ({timeAgo(lastSyncedAt, now)})
            </p>
            {syncError && (
              <p className="mt-2 flex gap-1.5 rounded-lg bg-warning-soft px-2.5 py-2 text-xs text-warning">
                <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                Last automatic sync failed — showing the last loaded data. {syncError}
              </p>
            )}

            <fieldset className="mt-4">
              <legend className="text-xs font-medium text-fg-muted">Auto-sync every</legend>
              <div className="mt-1.5 flex rounded-xl bg-surface-2 p-1" role="radiogroup" aria-label="Auto-sync interval">
                {AUTO_SYNC_OPTIONS.map((ms) => (
                  <button
                    key={ms}
                    type="button"
                    role="radio"
                    aria-checked={autoSyncMs === ms}
                    onClick={() => setAutoSyncMs(ms)}
                    className={cn(
                      "flex-1 rounded-lg py-1.5 text-xs font-medium transition",
                      autoSyncMs === ms ? "bg-primary-gradient text-white shadow-card" : "text-fg-muted hover:text-fg",
                    )}
                  >
                    {intervalLabel(ms)}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-fg-muted">
                {autoSyncMs
                  ? "Also syncs when you return to this tab, and right after every save. Paused while the tab is hidden."
                  : "Automatic sync is off. Data still updates after every save."}
              </p>
            </fieldset>

            <Button
              variant="secondary"
              size="sm"
              className="mt-4 w-full"
              onClick={() => void refresh()}
              loading={syncing}
              icon={<RefreshCw className="size-3.5" aria-hidden />}
            >
              Sync now
            </Button>
          </motion.div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
