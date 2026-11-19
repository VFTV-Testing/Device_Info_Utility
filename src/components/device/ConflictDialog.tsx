import { AlertTriangle } from "lucide-react";
import { RECORD_FIELDS, type DeviceRecord } from "../../../shared/types";
import { cn } from "../../lib/cn";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/primitives";

export interface ConflictState {
  key: string;
  mine: DeviceRecord;
  latest?: DeviceRecord;
}

export function ConflictDialog({
  conflict,
  onClose,
  onLoadLatest,
  onKeepMine,
}: {
  conflict: ConflictState | null;
  onClose: () => void;
  onLoadLatest: (latest: DeviceRecord) => void;
  onKeepMine: (latest: DeviceRecord) => void;
}) {
  const latest = conflict?.latest;
  return (
    <Dialog
      open={Boolean(conflict)}
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-danger" aria-hidden /> Conflict detected — nothing was saved
        </span>
      }
      description={
        latest
          ? "Someone else saved this record in GitHub after you loaded it. Review the latest values before deciding."
          : "This record no longer exists in GitHub. Someone may have deleted it."
      }
      footer={
        latest ? (
          <>
            <Button variant="secondary" onClick={() => onLoadLatest(latest)}>
              Discard mine, load latest
            </Button>
            <Button variant="primary" onClick={() => onKeepMine(latest)}>
              Keep my edits and review
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose}>
            OK
          </Button>
        )
      }
    >
      {conflict && (
        <div className="space-y-3">
          <p className="break-all font-mono text-xs text-fg-muted">{conflict.key}</p>
          {latest && (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-left text-xs text-fg-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Field</th>
                    <th className="px-3 py-2 font-medium">Your value</th>
                    <th className="px-3 py-2 font-medium">Latest in GitHub</th>
                  </tr>
                </thead>
                <tbody>
                  {RECORD_FIELDS.map((field) => {
                    const differs = conflict.mine[field] !== latest[field];
                    return (
                      <tr key={field} className={cn("border-t border-border", differs && "bg-warning-soft")}>
                        <td className="px-3 py-2 font-mono text-xs">{field}</td>
                        <td className="px-3 py-2 font-mono text-xs">{conflict.mine[field]}</td>
                        <td className={cn("px-3 py-2 font-mono text-xs", differs && "font-semibold text-warning")}>{latest[field]}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
