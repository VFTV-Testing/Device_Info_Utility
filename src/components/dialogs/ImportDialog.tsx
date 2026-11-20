import { fieldLabel } from "../../lib/fields";
import { AlertTriangle, FileUp, Info, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { analyzeImport, buildImportMutations } from "../../../shared/importer";
import type { ImportMode } from "../../../shared/types";
import { useDeviceData } from "../../context/DeviceDataContext";
import { cn } from "../../lib/cn";
import { ApiError } from "../../services/api";
import { commitToast } from "../device/RecordForm";
import { ConfirmDialog, Dialog } from "../ui/Dialog";
import { Badge, Button, Notice } from "../ui/primitives";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { snapshot, importRecords, writing, refresh, config } = useDeviceData();
  const [fileName, setFileName] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportMode>("add-only");
  const [confirming, setConfirming] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) return;
    setFileName(null);
    setText(null);
    setReadError(null);
    setMode("add-only");
  }, [open]);

  // Re-analysed automatically whenever the latest data changes (e.g. after a refresh).
  const analysis = useMemo(() => (text === null ? null : analyzeImport(text, snapshot?.data ?? {})), [text, snapshot]);
  const mutations = useMemo(() => (analysis && analysis.errors.length === 0 ? buildImportMutations(analysis, mode) : []), [analysis, mode]);

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    setReadError(null);
    if (file.size > MAX_FILE_BYTES) {
      setReadError("The file is larger than 5 MB.");
      return;
    }
    setFileName(file.name);
    setText(await file.text());
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void loadFile(event.dataTransfer.files[0]);
  };

  const apply = async () => {
    try {
      const result = await importRecords(mode, mutations);
      setConfirming(false);
      onOpenChange(false);
      commitToast(`Imported ${mutations.length} record${mutations.length === 1 ? "" : "s"}`, result.commit, config?.storage === "local");
    } catch (e) {
      const error = e as ApiError;
      setConfirming(false);
      if (error.code === "RECORD_CONFLICT") {
        toast.error("Import blocked — data changed in GitHub", {
          description: `${error.message} The preview has been refreshed with the latest data; review it and import again.`,
        });
        void refresh();
      } else {
        toast.error("Import failed — nothing was changed", { description: error.message });
      }
    }
  };

  const canImport = Boolean(analysis && analysis.errors.length === 0 && mutations.length > 0);
  const updates = mode === "update-existing" ? (analysis?.changed.length ?? 0) : 0;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        locked={writing}
        size="xl"
        title="Import device records"
        description="Upload a JSON file in the same format as deviceInformation.json. You'll see a preview before anything is saved."
        footer={
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={writing}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!canImport} loading={writing} onClick={() => setConfirming(true)} icon={<Upload className="size-4" />}>
              Review & import {mutations.length > 0 ? `(${mutations.length})` : ""}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition",
              dragging ? "border-accent bg-accent-soft" : "border-border bg-surface-2",
            )}
          >
            <FileUp className="mb-2 size-6 text-fg-subtle" aria-hidden />
            <p className="text-sm font-medium">{fileName ?? "Drop a .json file here"}</p>
            <p className="mt-1 text-xs text-fg-muted">or</p>
            <Button size="sm" className="mt-2" onClick={() => inputRef.current?.click()}>
              Choose file
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              aria-label="JSON file to import"
              onChange={(e) => {
                void loadFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>

          {readError && <Notice tone="danger" icon={<AlertTriangle className="size-4" />} title={readError} />}

          {analysis && analysis.errors.length > 0 && (
            <Notice tone="danger" icon={<AlertTriangle className="size-4" />} title={`The file cannot be imported (${analysis.errors.length} problem${analysis.errors.length === 1 ? "" : "s"})`}>
              <ul className="mt-1 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-4">
                {analysis.errors.slice(0, 100).map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </Notice>
          )}

          {analysis && analysis.errors.length === 0 && (
            <>
              {analysis.warnings.length > 0 && (
                <Notice tone="warning" icon={<Info className="size-4" />} title="Warnings">
                  <ul className="mt-1 list-disc pl-4">
                    {analysis.warnings.slice(0, 20).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </Notice>
              )}

              <div className="flex flex-wrap gap-2">
                <Badge tone="success">{analysis.newKeys.length} new</Badge>
                <Badge tone="warning">{analysis.changed.length} existing with different values</Badge>
                <Badge>{analysis.unchanged.length} identical (skipped)</Badge>
              </div>

              <fieldset>
                <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Import mode</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ["add-only", "Add only", "Adds new records. Existing records are never overwritten."],
                      ["update-existing", "Update existing", "Adds new records and updates the existing records listed below."],
                    ] as const
                  ).map(([value, label, help]) => (
                    <label
                      key={value}
                      className={cn(
                        "flex cursor-pointer gap-3 rounded-xl border p-3 transition",
                        mode === value ? "border-accent bg-accent-soft" : "border-border hover:border-border-strong",
                      )}
                    >
                      <input type="radio" name="import-mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="mt-1 accent-[var(--accent)]" />
                      <span>
                        <span className="block text-sm font-medium">{label}</span>
                        <span className="block text-xs text-fg-muted">{help}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {analysis.newKeys.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">New records ({analysis.newKeys.length})</h3>
                  <ul className="max-h-40 overflow-y-auto rounded-xl border border-border bg-surface-2 p-2 font-mono text-xs">
                    {analysis.newKeys.map((k) => (
                      <li key={k} className="break-all px-1 py-0.5 text-success">
                        + {k}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {analysis.changed.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">
                    Existing records with different values ({analysis.changed.length}){" "}
                    {mode === "add-only" ? <Badge>will be skipped</Badge> : <Badge tone="warning">will be updated</Badge>}
                  </h3>
                  <div className={cn("max-h-64 space-y-2 overflow-y-auto", mode === "add-only" && "opacity-60")}>
                    {analysis.changed.map((change) => (
                      <div key={change.key} className="rounded-xl border border-border p-3">
                        <p className="break-all font-mono text-xs font-semibold">{change.key}</p>
                        <ul className="mt-1 space-y-0.5 font-mono text-xs">
                          {change.fields.map((f) => (
                            <li key={f}>
                              <span className="text-fg-muted">{fieldLabel(f)}:</span> <span className="text-danger line-through">{change.before[f]}</span> →{" "}
                              <span className="text-success">{change.after[f]}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {mutations.length === 0 && (
                <Notice tone="neutral" icon={<Info className="size-4" />} title="Nothing to import">
                  {mode === "add-only" && analysis.changed.length > 0
                    ? "All records already exist. Switch to “Update existing” to apply the different values."
                    : "Every record in the file already exists with identical values."}
                </Notice>
              )}
            </>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Confirm import"
        tone={updates > 0 ? "danger" : "primary"}
        confirmLabel={updates > 0 ? `Import and update ${updates}` : "Import"}
        loading={writing}
        onConfirm={() => void apply()}
      >
        <ul className="space-y-1 text-sm">
          <li>
            <strong>{analysis?.newKeys.length ?? 0}</strong> new record(s) will be added.
          </li>
          {mode === "update-existing" && (
            <li>
              <strong>{updates}</strong> existing record(s) will be modified.
            </li>
          )}
          <li className="text-fg-muted">All other records stay unchanged. Changes are committed in a single commit.</li>
        </ul>
      </ConfirmDialog>
    </>
  );
}
