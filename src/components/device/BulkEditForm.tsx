import { fieldLabel } from "../../lib/fields";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Layers, RotateCcw, Save } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { naturalCompare } from "../../../shared/deviceId";
import { RECORD_FIELDS, type DeviceRecord, type RecordField } from "../../../shared/types";
import { recordsEqual, validateRecordValues } from "../../../shared/validation";
import { useDeviceData, type RecordUpdate } from "../../context/DeviceDataContext";
import { cn } from "../../lib/cn";
import { ApiError } from "../../services/api";
import { ConfirmDialog } from "../ui/Dialog";
import { Badge, Button, FieldError, FieldLabel, Input, Notice } from "../ui/primitives";
import { commitToast, FIELD_META, useFieldSuggestions } from "./RecordForm";

type Draft = Partial<Record<RecordField, string>>;

interface BulkEditFormProps {
  /** Full identifiers of the records to edit. */
  keys: string[];
  /** Called after a successful save. */
  onSaved?: () => void;
  onCancel?: () => void;
  /** Inside a dialog that already has its own title: drop the card frame and big header. */
  embedded?: boolean;
}

/**
 * Edits several records at once. Only fields the user fills in are changed;
 * every other field keeps each record's own value. All changes go into ONE commit,
 * and nothing is saved if any record changed in GitHub meanwhile.
 */
export function BulkEditForm({ keys, onSaved, onCancel, embedded = false }: BulkEditFormProps) {
  const { snapshot, updateRecords, writing, setHasUnsavedChanges, refresh, config } = useDeviceData();
  const suggestions = useFieldSuggestions();
  const [draft, setDraft] = useState<Draft>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const local = config?.storage === "local";

  const data = snapshot?.data ?? {};
  const available = useMemo(() => keys.filter((k) => k in data).sort(naturalCompare), [keys, data]);
  const included = available.filter((k) => !excluded.has(k));

  const filled = RECORD_FIELDS.filter((f) => (draft[f] ?? "") !== "");
  const dirty = filled.length > 0;

  useEffect(() => {
    setHasUnsavedChanges(dirty);
  }, [dirty, setHasUnsavedChanges]);
  useEffect(() => () => setHasUnsavedChanges(false), [setHasUnsavedChanges]);

  /** Distinct current values per field across the included records, most common first. */
  const distinct = useMemo(() => {
    const result = {} as Record<RecordField, string[]>;
    for (const field of RECORD_FIELDS) {
      const counts = new Map<string, number>();
      for (const key of included) {
        const value = data[key]![field];
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      result[field] = [...counts.entries()].sort((a, b) => b[1] - a[1] || naturalCompare(a[0], b[0])).map(([v]) => v);
    }
    return result;
  }, [included, data]);

  const planned = useMemo(() => {
    const updates: RecordUpdate[] = [];
    for (const key of included) {
      const base = data[key]!;
      const values: DeviceRecord = { ...base };
      for (const field of filled) values[field] = draft[field]!;
      if (!recordsEqual(base, values)) updates.push({ key, base, values });
    }
    return updates;
  }, [included, data, filled, draft]);

  const errors = useMemo(() => {
    const result: Partial<Record<RecordField, string>> = {};
    const sample = planned[0]?.values;
    if (!sample) return result;
    const found = validateRecordValues(sample) as Partial<Record<RecordField, string>>;
    for (const field of filled) if (found[field]) result[field] = found[field];
    return result;
  }, [planned, filled]);
  const valid = Object.keys(errors).length === 0;
  const unchanged = included.length - planned.length;
  const countLabel = `Update ${planned.length} record${planned.length === 1 ? "" : "s"}`;

  const reset = () => {
    setDraft({});
    setSaveError(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!dirty || !valid || planned.length === 0 || writing) return;
    setConfirming(true);
  };

  const save = async () => {
    setSaveError(null);
    try {
      const result = await updateRecords(planned);
      setConfirming(false);
      commitToast(`Updated ${planned.length} record${planned.length === 1 ? "" : "s"}${local ? "" : " in GitHub"}`, result.commit, local);
      reset();
      onSaved?.();
    } catch (e) {
      setConfirming(false);
      const error = e as ApiError;
      if (error.code === "RECORD_CONFLICT") {
        const message = `${error.conflicts.length} of the selected records changed in GitHub while you were editing. Nothing was saved — the latest values are loaded, check them and save again.`;
        setSaveError(message);
        toast.error("Conflict — nothing was saved", { description: error.conflicts.map((c) => c.key).join("\n") });
        void refresh();
      } else {
        setSaveError(error.message);
        toast.error("Bulk update failed — nothing was changed", { description: error.message });
      }
    }
  };

  const toggleRecord = (key: string) =>
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Bulk edit"
      data-testid="bulk-edit"
      className={cn(!embedded && "glass overflow-hidden rounded-3xl border shadow-card")}
    >
      <div className={cn("flex flex-wrap items-center gap-3", embedded ? "pb-1" : "border-b border-border bg-hero-gradient px-5 py-4")}>
        {!embedded && (
          <div className="grid size-10 place-items-center rounded-2xl bg-primary-gradient text-white shadow-card">
            <Layers className="size-5" aria-hidden />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className={cn("font-display font-bold text-fg", embedded ? "text-sm" : "text-lg")}>
            Bulk edit · {included.length} of {available.length} record{available.length === 1 ? "" : "s"}
          </p>
          {!embedded && (
            <p className="text-[13px] text-fg-muted">Fill in only the fields you want to change. Empty fields keep each record’s own value.</p>
          )}
        </div>
        <AnimatePresence>
          {dirty && (
            <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
              <Badge tone="warning">
                {planned.length} will change{unchanged > 0 ? ` · ${unchanged} already match` : ""}
              </Badge>
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className={cn("space-y-5", embedded ? "py-4" : "p-5")}>
        {saveError && (
          <Notice tone="danger" icon={<AlertTriangle className="size-4" />} title="Nothing was saved">
            {saveError}
          </Notice>
        )}

        <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {RECORD_FIELDS.map((field) => {
            const meta = FIELD_META[field];
            const id = `bulk-${field}`;
            const values = distinct[field];
            const current = draft[field] ?? "";
            const list = field === "Hardware" || field === "Country" ? `${id}-options` : undefined;
            return (
              <div key={field}>
                <FieldLabel htmlFor={id} hint={values.length > 1 ? `${values.length} different values` : meta.hint}>
                  <span className="inline-flex items-center gap-1.5 font-mono">
                    {meta.label}
                    {current !== "" && <span className="size-1.5 rounded-full bg-warning" aria-label="will change" />}
                  </span>
                </FieldLabel>
                <Input
                  id={id}
                  value={current}
                  placeholder={values.length === 1 ? `Keep: ${values[0]}` : "Keep each record’s value"}
                  autoComplete="off"
                  spellCheck={false}
                  list={list}
                  invalid={Boolean(errors[field])}
                  onChange={(e) => {
                    setDraft((d) => ({ ...d, [field]: e.target.value }));
                    setSaveError(null);
                  }}
                  className={cn("font-mono", current !== "" && !errors[field] && "border-warning/60")}
                />
                {list && (
                  <datalist id={list}>
                    {suggestions[field as "Hardware" | "Country"].map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                )}
                {errors[field] ? (
                  <FieldError>{errors[field]}</FieldError>
                ) : (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {values.slice(0, 3).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setDraft((d) => ({ ...d, [field]: v }))}
                        title={`Use ${v} for all selected records`}
                        className="max-w-full truncate rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-fg-muted transition hover:bg-accent-soft hover:text-accent"
                      >
                        {v}
                      </button>
                    ))}
                    {values.length > 3 && <span className="px-1 text-[11px] text-fg-subtle">+{values.length - 3} more</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-fg-muted">Records in this update — untick any to leave it out</p>
          <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-2xl border border-border">
            {available.map((key) => {
              const on = !excluded.has(key);
              const change = planned.find((u) => u.key === key);
              return (
                <li key={key} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 transition", !on && "opacity-50")}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleRecord(key)}
                    aria-label={`Include ${key}`}
                    className="size-4 shrink-0 accent-[var(--primary-from)]"
                  />
                  <span className="min-w-0 flex-1 break-all font-mono text-xs text-fg">{key}</span>
                  {on && change && (
                    <span className="flex flex-wrap gap-1.5">
                      {filled
                        .filter((f) => change.base[f] !== change.values[f])
                        .map((f) => (
                          <span key={f} className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 font-mono text-[11px] text-warning">
                            {fieldLabel(f)}: {change.base[f] || "—"} <ArrowRight className="size-3" aria-hidden /> {change.values[f]}
                          </span>
                        ))}
                    </span>
                  )}
                  {on && dirty && !change && <span className="text-[11px] text-fg-subtle">already up to date</span>}
                </li>
              );
            })}
          </ul>
          {available.length < keys.length && (
            <p className="mt-2 text-xs text-warning">{keys.length - available.length} selected record(s) no longer exist in the file and were left out.</p>
          )}
        </div>
      </div>

      <div
        className={cn(
          "flex flex-col-reverse gap-2 border-t border-border sm:flex-row sm:items-center sm:justify-end",
          embedded ? "pt-3" : "px-5 py-3",
        )}
      >
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={writing}>
            Cancel
          </Button>
        )}
        <Button variant="secondary" onClick={reset} disabled={!dirty || writing} icon={<RotateCcw className="size-4" />}>
          Reset
        </Button>
        <Button type="submit" variant="primary" loading={writing} disabled={!dirty || !valid || planned.length === 0} icon={<Save className="size-4" />}>
          {writing ? "Saving…" : planned.length ? countLabel : "Update records"}
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`${countLabel}?`}
        description={
          local
            ? "All changes are written to the local file together."
            : "All changes go into one commit to deviceInformation.json. If any record changed in GitHub meanwhile, nothing is saved."
        }
        confirmLabel={countLabel}
        loading={writing}
        onConfirm={() => void save()}
      >
        <ul className="space-y-1 text-[13px]">
          {filled.map((f) => (
            <li key={f} className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-fg-muted">{fieldLabel(f)}</span>
              <ArrowRight className="size-3 text-fg-subtle" aria-hidden />
              <span className="font-mono font-semibold text-fg">{draft[f]}</span>
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </form>
  );
}
