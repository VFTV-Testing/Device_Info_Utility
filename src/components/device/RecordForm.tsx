import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, RotateCcw, Save, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { parseDeviceId } from "../../../shared/deviceId";
import { RECORD_FIELDS, type DeviceRecord, type RecordField } from "../../../shared/types";
import { changedFields, recordsEqual, validateRecordValues } from "../../../shared/validation";
import { useDeviceData } from "../../context/DeviceDataContext";
import { cn, shortSha } from "../../lib/cn";
import { ApiError } from "../../services/api";
import { ConfirmDialog } from "../ui/Dialog";
import { Badge, Button, Card, FieldError, FieldLabel, Input, Notice } from "../ui/primitives";
import { ConflictDialog, type ConflictState } from "./ConflictDialog";

export const FIELD_META: Record<RecordField, { label: string; hint: string; placeholder: string }> = {
  sprintNo: { label: "sprintNo", hint: "Sprint + firmware", placeholder: "67.00+422608.047.00150" },
  Cver: { label: "Cver", hint: "Client version", placeholder: "0.67.00" },
  firmwareVersion: { label: "firmwareVersion", hint: "Firmware build", placeholder: "422608.047.00150" },
  appVersion: { label: "appVersion", hint: "Application version", placeholder: "0.67.00" },
  Hardware: { label: "Platform", hint: "Hardware field in the file", placeholder: "AVSB" },
  Country: { label: "Country", hint: "Country / service", placeholder: "DE_DVBC" },
};

export function useFieldSuggestions(): Record<"Hardware" | "Country", string[]> {
  const { snapshot } = useDeviceData();
  return useMemo(() => {
    const hardware = new Set<string>();
    const country = new Set<string>();
    for (const record of Object.values(snapshot?.data ?? {})) {
      hardware.add(record.Hardware);
      country.add(record.Country);
    }
    return { Hardware: [...hardware].sort(), Country: [...country].sort() };
  }, [snapshot]);
}

export function commitToast(title: string, commit: { sha: string; url?: string }, local: boolean) {
  toast.success(title, {
    description: local ? `Written to the local file (${shortSha(commit.sha)})` : `Commit ${shortSha(commit.sha)} confirmed by GitHub`,
    action: commit.url ? { label: "View", onClick: () => window.open(commit.url, "_blank", "noopener") } : undefined,
  });
}

interface RecordFormProps {
  recordKey: string;
  /** Latest version of the record from the current snapshot. */
  record: DeviceRecord;
  onClose: () => void;
  onDeleted: () => void;
}

export function RecordForm({ recordKey, record, onClose, onDeleted }: RecordFormProps) {
  const { updateRecord, deleteRecord, writing, setHasUnsavedChanges, refresh, config, setConflictActive } = useDeviceData();
  const suggestions = useFieldSuggestions();
  const [base, setBase] = useState<DeviceRecord>(record);
  const [values, setValues] = useState<DeviceRecord>(record);
  const [touched, setTouched] = useState<Partial<Record<RecordField, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dirty = !recordsEqual(values, base);
  const errors = validateRecordValues(values);
  const valid = Object.keys(errors).length === 0;
  const changed = changedFields(base, values);
  const staleInGitHub = !recordsEqual(record, base);
  const parsed = parseDeviceId(recordKey);
  const local = config?.storage === "local";

  // Load a different record → reset the form.
  useEffect(() => {
    setBase(record);
    setValues(record);
    setTouched({});
    setSubmitted(false);
    setSaveError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordKey]);

  // Data refreshed while the form is clean → show the latest values. Dirty forms keep the user's edits.
  useEffect(() => {
    if (!dirty && !recordsEqual(record, base)) {
      setBase(record);
      setValues(record);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record]);

  useEffect(() => {
    setHasUnsavedChanges(dirty);
  }, [dirty, setHasUnsavedChanges]);
  useEffect(() => () => setHasUnsavedChanges(false), [setHasUnsavedChanges]);

  const setField = (field: RecordField, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setSaveError(null);
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!valid || !dirty || writing) return;
    setSaveError(null);
    try {
      const result = await updateRecord(recordKey, base, values);
      const saved = result.data[recordKey] ?? values;
      setBase(saved);
      setValues(saved);
      setSubmitted(false);
      setTouched({});
      commitToast(local ? "Saved" : "Saved to GitHub", result.commit, local);
    } catch (e) {
      const error = e as ApiError;
      if (error.code === "RECORD_CONFLICT") {
        setConflict({ key: recordKey, mine: values, latest: error.conflicts[0]?.latest });
        void refresh();
      } else {
        setSaveError(error.message);
        toast.error("Save failed — nothing was changed", { description: error.message });
      }
    }
  };

  const handleDelete = async () => {
    try {
      const result = await deleteRecord(recordKey, base);
      setConfirmDelete(false);
      commitToast(local ? "Record deleted" : "Record deleted in GitHub", result.commit, local);
      setHasUnsavedChanges(false);
      onDeleted();
    } catch (e) {
      const error = e as ApiError;
      setConfirmDelete(false);
      if (error.code === "RECORD_CONFLICT") {
        setConflict({ key: recordKey, mine: base, latest: error.conflicts[0]?.latest });
        void refresh();
      } else {
        toast.error("Delete failed — nothing was changed", { description: error.message });
      }
    }
  };

  return (
    <Card className="overflow-hidden">
      <form onSubmit={handleSave} noValidate aria-label="Device information">
        <div className="border-b border-border bg-surface-2/60 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Matched record</span>
            {parsed && <Badge tone="accent">{parsed.device}</Badge>}
            {parsed && <Badge tone="accent">{parsed.port}</Badge>}
            <AnimatePresence>
              {dirty && (
                <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
                  <Badge tone="warning">
                    Unsaved changes · {changed.length} field{changed.length === 1 ? "" : "s"}
                  </Badge>
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <p data-testid="matched-key" className="mt-2 break-all font-mono text-[15px] font-semibold text-fg sm:text-base">
            {recordKey}
          </p>
        </div>

        <div className="space-y-5 p-5">
          {staleInGitHub && dirty && (
            <Notice tone="warning" icon={<AlertTriangle className="size-4" />} title="This record changed in GitHub while you were editing">
              Saving will be blocked so nothing is overwritten. You'll be able to compare your edits with the latest values.
            </Notice>
          )}
          {saveError && (
            <Notice tone="danger" icon={<AlertTriangle className="size-4" />} title="Your changes were not saved">
              {saveError}
            </Notice>
          )}

          <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
            {RECORD_FIELDS.map((field) => {
              const meta = FIELD_META[field];
              const id = `field-${field}`;
              const showError = (touched[field] || submitted) && errors[field];
              const isChanged = values[field] !== base[field];
              const list = field === "Hardware" || field === "Country" ? `${id}-options` : undefined;
              return (
                <div key={field}>
                  <FieldLabel htmlFor={id} hint={meta.hint}>
                    <span className="inline-flex items-center gap-1.5 font-mono">
                      {meta.label}
                      {isChanged && <span className="size-1.5 rounded-full bg-warning" aria-label="changed" />}
                    </span>
                  </FieldLabel>
                  <Input
                    id={id}
                    name={field}
                    value={values[field]}
                    placeholder={meta.placeholder}
                    autoComplete="off"
                    spellCheck={false}
                    list={list}
                    invalid={Boolean(showError)}
                    aria-describedby={showError ? `${id}-error` : undefined}
                    onChange={(e) => setField(field, e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, [field]: true }))}
                    className={cn("font-mono", isChanged && !showError && "border-warning/60")}
                  />
                  {list && (
                    <datalist id={list}>
                      {suggestions[field as "Hardware" | "Country"].map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  )}
                  {showError ? (
                    <FieldError id={`${id}-error`}>{errors[field]}</FieldError>
                  ) : (
                    isChanged && (
                      <p className="mt-1 truncate text-xs text-fg-subtle">
                        was <span className="font-mono">{base[field] || "—"}</span>
                      </p>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-3 sm:flex-row sm:items-center">
          <Button variant="danger-ghost" onClick={() => setConfirmDelete(true)} disabled={writing} icon={<Trash2 className="size-4" />}>
            Delete record
          </Button>
          <div className="flex flex-1 flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={writing} icon={<X className="size-4" />}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setValues(base);
                setTouched({});
                setSubmitted(false);
                setSaveError(null);
              }}
              disabled={!dirty || writing}
              icon={<RotateCcw className="size-4" />}
            >
              Reset changes
            </Button>
            <Button type="submit" variant="primary" loading={writing} disabled={!dirty || (submitted && !valid)} icon={<Save className="size-4" />}>
              {writing ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </form>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this record?"
        description={local ? "The record will be removed from the local file." : "The record will be removed from deviceInformation.json with a commit to GitHub."}
        confirmLabel="Delete record"
        tone="danger"
        loading={writing}
        onConfirm={() => void handleDelete()}
      >
        <p className="break-all rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs">{recordKey}</p>
        <p className="mt-3 text-[13px] text-fg-muted">Only this exact record is deleted. All other records stay unchanged.</p>
      </ConfirmDialog>

      <ConflictDialog
        conflict={conflict}
        onClose={() => {
          setConflict(null);
          setConflictActive(false);
          if (!conflict?.latest) onDeleted();
        }}
        onLoadLatest={(latest) => {
          setBase(latest);
          setValues(latest);
          setConflict(null);
          setConflictActive(false);
          toast.info("Loaded the latest values from GitHub");
        }}
        onKeepMine={(latest) => {
          setBase(latest);
          setConflict(null);
          setConflictActive(false);
          toast.info("Your edits are kept", { description: "Fields that differ from GitHub are highlighted. Review and save again." });
        }}
      />
    </Card>
  );
}
