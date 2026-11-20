import { fieldLabel } from "../../lib/fields";
import { AlertTriangle, CheckCircle2, Copy, Plus } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { buildDeviceId, naturalCompare, normalizePort } from "../../../shared/deviceId";
import { RECORD_FIELDS, type DeviceRecord, type RecordField } from "../../../shared/types";
import { pickRecord, validateNewKeyParts, validateRecordValues } from "../../../shared/validation";
import { useDeviceData } from "../../context/DeviceDataContext";
import { cn } from "../../lib/cn";
import { ApiError } from "../../services/api";
import { commitToast, FIELD_META, useFieldSuggestions } from "../device/RecordForm";
import { Dialog } from "../ui/Dialog";
import { Button, FieldError, FieldLabel, Input, NativeSelect, Notice } from "../ui/primitives";

const EMPTY_VALUES: DeviceRecord = pickRecord({});

export interface AddDeviceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDevice?: string;
  initialPort?: string;
  onCreated?: (key: string) => void;
}

export function AddDeviceDialog({ open, onOpenChange, initialDevice, initialPort, onCreated }: AddDeviceDialogProps) {
  const { snapshot, index, createRecord, writing, config } = useDeviceData();
  const data = snapshot?.data ?? {};
  const suggestions = useFieldSuggestions();

  const [device, setDevice] = useState("");
  const [port, setPort] = useState("");
  const [suffix, setSuffix] = useState("");
  const [values, setValues] = useState<DeviceRecord>(EMPTY_VALUES);
  const [template, setTemplate] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDevice(initialDevice ?? "");
    setPort(initialPort ?? "");
    setSuffix("");
    setValues(EMPTY_VALUES);
    setTemplate("");
    setSubmitted(false);
    setServerError(null);
  }, [open, initialDevice, initialPort]);

  const suffixSuggestions = useMemo(() => {
    const own = index.parsed.filter((id) => id.device === device).map((id) => id.suffix);
    const all = index.parsed.map((id) => id.suffix);
    return [...new Set([...own, ...all])].slice(0, 200);
  }, [index, device]);

  const templateOptions = useMemo(() => Object.keys(data).sort(naturalCompare), [data]);

  const keyErrors = validateNewKeyParts({ device, port, suffix }, data);
  const fieldErrors = validateRecordValues(values);
  const keyValid = Object.keys(keyErrors).length === 0;
  const valid = keyValid && Object.keys(fieldErrors).length === 0;
  const previewKey = buildDeviceId(device || "<device>", port || "PORT<n>", suffix || "<remaining-segments>");

  const applyTemplate = (key: string) => {
    setTemplate(key);
    const record = data[key];
    if (record) setValues(pickRecord(record));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!valid || writing) return;
    const key = buildDeviceId(device, port, suffix);
    setServerError(null);
    try {
      const result = await createRecord(key, values);
      commitToast(config?.storage === "local" ? "Device added" : "Device added to GitHub", result.commit, config?.storage === "local");
      onOpenChange(false);
      onCreated?.(key);
    } catch (e) {
      const error = e as ApiError;
      setServerError(error.message);
      toast.error("Device was not added", { description: error.message });
    }
  };

  const showKeyError = (field: "device" | "port" | "suffix") => (submitted || (field === "device" ? device : field === "port" ? port : suffix)) && keyErrors[field];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      locked={writing}
      size="lg"
      title="Add new device"
      description="Creates a new record. Existing records are never overwritten."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={writing}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="add-device-form" loading={writing} icon={<Plus className="size-4" />}>
            {writing ? "Adding…" : "Add device"}
          </Button>
        </>
      }
    >
      <form id="add-device-form" onSubmit={handleSubmit} noValidate className="space-y-5">
        <fieldset className="space-y-4">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Device identifier</legend>
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <div>
              <FieldLabel htmlFor="new-device" hint="e.g. X101-GER">
                Robot
              </FieldLabel>
              <Input
                id="new-device"
                value={device}
                list="new-device-options"
                autoComplete="off"
                spellCheck={false}
                placeholder="X101-GER"
                invalid={Boolean(showKeyError("device"))}
                onChange={(e) => setDevice(e.target.value.trim())}
                className="font-mono"
              />
              <datalist id="new-device-options">
                {index.devices.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
              <FieldError>{showKeyError("device")}</FieldError>
            </div>
            <div>
              <FieldLabel htmlFor="new-port">Device port</FieldLabel>
              <Input
                id="new-port"
                value={port}
                autoComplete="off"
                placeholder="PORT1"
                invalid={Boolean(showKeyError("port"))}
                onChange={(e) => setPort(e.target.value.trim().toUpperCase())}
                onBlur={() => {
                  const normalized = normalizePort(port);
                  if (normalized) setPort(normalized);
                }}
                className="font-mono"
              />
              <FieldError>{showKeyError("port")}</FieldError>
            </div>
          </div>
          <div>
            <FieldLabel htmlFor="new-suffix" hint="platform, memory, country, stream type…">
              Remaining identifier segments
            </FieldLabel>
            <Input
              id="new-suffix"
              value={suffix}
              list="new-suffix-options"
              autoComplete="off"
              spellCheck={false}
              placeholder="AVSB-FUT_EMMC_Rayson-DE_PROD-DVBC"
              invalid={Boolean(showKeyError("suffix"))}
              onChange={(e) => setSuffix(e.target.value.trim())}
              className="font-mono"
            />
            <datalist id="new-suffix-options">
              {suffixSuggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <FieldError>{showKeyError("suffix")}</FieldError>
          </div>

          <div
            className={cn(
              "rounded-xl border p-3",
              keyErrors.key ? "border-danger/40 bg-danger-soft" : keyValid ? "border-success/40 bg-success-soft" : "border-border bg-surface-2",
            )}
          >
            <p className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
              {keyValid ? <CheckCircle2 className="size-3.5 text-success" /> : keyErrors.key ? <AlertTriangle className="size-3.5 text-danger" /> : null}
              JSON key preview
            </p>
            <p data-testid="key-preview" className="mt-1 break-all font-mono text-sm font-semibold text-fg">
              {previewKey}
            </p>
            {keyErrors.key && <p className="mt-1 text-xs text-danger">{keyErrors.key}</p>}
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">Device information</legend>
            <div className="flex w-full items-center gap-2 sm:w-80">
              <Copy className="size-4 shrink-0 text-fg-subtle" aria-hidden />
              <NativeSelect aria-label="Copy values from an existing record" value={template} onChange={(e) => applyTemplate(e.target.value)} className="flex-1">
                <option value="">Copy values from… (optional)</option>
                {templateOptions.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
            {RECORD_FIELDS.map((field: RecordField) => {
              const id = `new-${field}`;
              const list = field === "Hardware" || field === "Country" ? `${id}-options` : undefined;
              const error = submitted && fieldErrors[field];
              return (
                <div key={field}>
                  <FieldLabel htmlFor={id} hint={FIELD_META[field].hint}>
                    <span className="font-mono">{fieldLabel(field)}</span>
                  </FieldLabel>
                  <Input
                    id={id}
                    value={values[field]}
                    list={list}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={FIELD_META[field].placeholder}
                    invalid={Boolean(error)}
                    onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
                    className="font-mono"
                  />
                  {list && (
                    <datalist id={list}>
                      {suggestions[field as "Hardware" | "Country"].map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  )}
                  <FieldError>{error}</FieldError>
                </div>
              );
            })}
          </div>
        </fieldset>

        {serverError && (
          <Notice tone="danger" icon={<AlertTriangle className="size-4" />} title="The device was not added">
            {serverError}
          </Notice>
        )}
      </form>
    </Dialog>
  );
}
