import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Cpu, Layers, MousePointerClick, Plug, Plus, SearchX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useBlocker, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { getPortsForDevice, parseDeviceId, resolveMatch } from "../../shared/deviceId";
import { DataStateGate } from "../components/common/DataStateGate";
import { PipelineSelect } from "../components/device/PipelineSelect";
import { RecordForm } from "../components/device/RecordForm";
import { AddDeviceDialog } from "../components/dialogs/AddDeviceDialog";
import { Combobox } from "../components/ui/Combobox";
import { ConfirmDialog } from "../components/ui/Dialog";
import { Button, Card, EmptyState, Notice } from "../components/ui/primitives";
import { useDeviceData } from "../context/DeviceDataContext";
import { cn } from "../lib/cn";

const fade = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.18 },
};

export function DeviceManagerPage() {
  const { snapshot, index, hasUnsavedChanges, setHasUnsavedChanges } = useDeviceData();
  const [device, setDevice] = useState<string | null>(null);
  const [port, setPort] = useState<string | null>(null);
  /** Explicit choice when several records share the same device + port. */
  const [chosenKey, setChosenKey] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const data = snapshot?.data ?? {};
  const ports = useMemo(() => getPortsForDevice(index, device), [index, device]);
  const match = useMemo(() => (device && port ? resolveMatch(index, device, port) : null), [index, device, port]);

  const activeKey =
    match?.kind === "single" ? match.key : match?.kind === "multiple" && chosenKey && match.keys.includes(chosenKey) ? chosenKey : null;
  const activeRecord = activeKey ? data[activeKey] : undefined;

  // Leaving the page with unsaved edits → ask first.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => hasUnsavedChanges && currentLocation.pathname !== nextLocation.pathname);

  /** Runs a selection change, asking for confirmation if the form has unsaved edits. */
  const guarded = (action: () => void) => {
    if (hasUnsavedChanges) setPendingAction(() => action);
    else action();
  };

  const selectKey = (key: string) => {
    const id = parseDeviceId(key);
    if (!id) return false;
    setDevice(id.device);
    setPort(id.port);
    setChosenKey(key);
    return true;
  };

  // Deep link from "All Devices → Edit": /?key=<full identifier>
  const keyParam = searchParams.get("key");
  useEffect(() => {
    if (!keyParam || !snapshot) return;
    if (!(keyParam in snapshot.data) || !selectKey(keyParam)) {
      toast.error("That record could not be found", { description: keyParam });
    }
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyParam, snapshot]);

  // If the selected device/port disappears after a refresh, fall back gracefully.
  useEffect(() => {
    if (!snapshot || !device) return;
    if (!index.portsByDevice.has(device)) {
      setDevice(null);
      setPort(null);
    } else if (port && !ports.includes(port) && !hasUnsavedChanges) {
      setPort(null);
    }
  }, [snapshot, index, device, port, ports, hasUnsavedChanges]);

  const deviceOptions = useMemo(
    () =>
      index.devices.map((d) => {
        const count = index.portsByDevice.get(d)?.length ?? 0;
        return { value: d, hint: `${count} port${count === 1 ? "" : "s"}` };
      }),
    [index],
  );
  const portOptions = useMemo(() => ports.map((p) => ({ value: p })), [ports]);

  const recordCount = Object.keys(data).length;

  return (
    <DataStateGate>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">Device Manager</h2>
            <p className="mt-1 text-sm text-fg-muted">Select a device and port to view and edit its information.</p>
          </div>
          <Button variant="primary" onClick={() => setAddOpen(true)} icon={<Plus className="size-4" />}>
            Add new device
          </Button>
        </div>

        <Card className="p-5">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label htmlFor="device-select" className="mb-1.5 block text-[13px] font-medium text-fg">
                Device
              </label>
              <Combobox
                id="device-select"
                label="Device"
                value={device}
                options={deviceOptions}
                placeholder="Select a device"
                searchPlaceholder="Search devices…"
                emptyText="No devices match"
                icon={<Cpu className="size-4" />}
                onChange={(next) =>
                  guarded(() => {
                    if (next !== device) {
                      setDevice(next);
                      setPort(null); // changing the device always resets the port
                      setChosenKey(null);
                    }
                  })
                }
              />
            </div>
            <div>
              <label htmlFor="port-select" className="mb-1.5 block text-[13px] font-medium text-fg">
                Port
              </label>
              <Combobox
                id="port-select"
                label="Port"
                value={port}
                options={portOptions}
                placeholder={device ? "Select a port" : "Select a device first"}
                searchPlaceholder="Search ports…"
                emptyText="No ports match"
                icon={<Plug className="size-4" />}
                disabled={!device}
                onChange={(next) =>
                  guarded(() => {
                    setPort(next);
                    setChosenKey(null);
                  })
                }
              />
            </div>
            <PipelineSelect />
          </div>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-fg-muted">
            <span>
              <strong className="font-semibold text-fg">{recordCount}</strong> records
            </span>
            <span>
              <strong className="font-semibold text-fg">{index.devices.length}</strong> devices
            </span>
            {index.unparsed.length > 0 && (
              <span className="text-warning">
                {index.unparsed.length} record(s) don’t follow the naming convention — see All Devices
              </span>
            )}
          </div>
        </Card>

        <AnimatePresence mode="wait">
          {!device || !port ? (
            <motion.div key="empty" {...fade}>
              <Card>
                <EmptyState
                  icon={<MousePointerClick className="size-5" />}
                  title={device ? "Now select a port" : "Select a device and port"}
                  description={
                    device
                      ? `${device} has ${ports.length} port${ports.length === 1 ? "" : "s"}: ${ports.join(", ")}.`
                      : "The matching record from deviceInformation.json will appear here for editing."
                  }
                />
              </Card>
            </motion.div>
          ) : match?.kind === "none" ? (
            <motion.div key="none" {...fade}>
              <Card>
                <EmptyState
                  icon={<SearchX className="size-5" />}
                  title="No existing record found for this Device and Port."
                  description={`Nothing matches ${device} ${port}. Nothing has been created or changed.`}
                  action={
                    <Button variant="primary" onClick={() => setAddOpen(true)} icon={<Plus className="size-4" />}>
                      Add new device
                    </Button>
                  }
                />
              </Card>
            </motion.div>
          ) : match?.kind === "multiple" && !activeKey ? (
            <motion.div key="multiple" {...fade}>
              <Notice
                tone="warning"
                icon={<Layers className="size-4" />}
                title={`${match.keys.length} records match ${device} ${port} — choose the exact record`}
              >
                <p className="mb-3">Nothing will be changed until you select one of these identifiers.</p>
                <div className="space-y-2" role="radiogroup" aria-label="Matching records">
                  {match.keys.map((key) => (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={false}
                      onClick={() => setChosenKey(key)}
                      className="block w-full break-all rounded-lg border border-border bg-surface px-3 py-2 text-left font-mono text-xs text-fg transition hover:border-accent hover:bg-accent-soft"
                    >
                      {key}
                    </button>
                  ))}
                </div>
              </Notice>
            </motion.div>
          ) : activeKey && activeRecord ? (
            <motion.div key={`form-${activeKey}`} {...fade} className="space-y-3">
              {match?.kind === "multiple" && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                  <AlertTriangle className="size-3.5 text-warning" aria-hidden />
                  {match.keys.length} records share {device} {port}.
                  <button type="button" className={cn("font-medium text-accent hover:underline")} onClick={() => guarded(() => setChosenKey(null))}>
                    Choose a different record
                  </button>
                </div>
              )}
              <RecordForm
                recordKey={activeKey}
                record={activeRecord}
                onClose={() =>
                  guarded(() => {
                    setPort(null);
                    setChosenKey(null);
                  })
                }
                onDeleted={() => {
                  setPort(null);
                  setChosenKey(null);
                }}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <AddDeviceDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        initialDevice={device ?? undefined}
        initialPort={match?.kind === "none" ? (port ?? undefined) : undefined}
        onCreated={(key) => {
          setHasUnsavedChanges(false);
          selectKey(key);
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingAction)}
        onOpenChange={(open) => !open && setPendingAction(null)}
        title="Discard unsaved changes?"
        description="You have edits that are not saved to GitHub. They will be lost."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        tone="danger"
        onConfirm={() => {
          const action = pendingAction;
          setPendingAction(null);
          setHasUnsavedChanges(false);
          action?.();
        }}
      />

      <ConfirmDialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => !open && blocker.state === "blocked" && blocker.reset()}
        title="Leave without saving?"
        description="You have edits that are not saved to GitHub. They will be lost if you leave this page."
        confirmLabel="Leave page"
        cancelLabel="Stay"
        tone="danger"
        onConfirm={() => {
          setHasUnsavedChanges(false);
          if (blocker.state === "blocked") blocker.proceed();
        }}
      />
    </DataStateGate>
  );
}
