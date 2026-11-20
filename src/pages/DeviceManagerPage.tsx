import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Cpu, Layers, MousePointerClick, Plug, Plus, SearchX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useBlocker, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { parseDeviceId, resolveMatch } from "../../shared/deviceId";
import { DataStateGate } from "../components/common/DataStateGate";
import { BulkEditForm } from "../components/device/BulkEditForm";
import { PipelineSelect } from "../components/device/PipelineSelect";
import { RecordForm } from "../components/device/RecordForm";
import { AddDeviceDialog } from "../components/dialogs/AddDeviceDialog";
import { ConfirmDialog } from "../components/ui/Dialog";
import { MultiSelect } from "../components/ui/MultiSelect";
import { Button, Card, EmptyState, Notice } from "../components/ui/primitives";
import { useDeviceData } from "../context/DeviceDataContext";
import { cn } from "../lib/cn";

const fade = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.18 },
};

const pairKey = (device: string, port: string) => `${device}|${port}`;
const splitPair = (pair: string): [string, string] => {
  const i = pair.lastIndexOf("|");
  return [pair.slice(0, i), pair.slice(i + 1)];
};

export function DeviceManagerPage() {
  const { snapshot, index, hasUnsavedChanges, setHasUnsavedChanges } = useDeviceData();
  const [devices, setDevices] = useState<string[]>([]);
  /** Exact device + port pairs ("X101-GER|PORT1"), so each device can have its own ports. */
  const [pairs, setPairs] = useState<string[]>([]);
  /** Explicit choice when several records share the same device + port. */
  const [chosenKey, setChosenKey] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const data = snapshot?.data ?? {};
  /** Exactly one device + port pair → the single-record editor; more pairs → bulk edit. */
  const single = pairs.length === 1;
  const [device, port] = single ? splitPair(pairs[0]!) : [devices.length === 1 ? devices[0]! : null, null];
  const ports = useMemo(() => (devices.length === 1 ? (index.portsByDevice.get(devices[0]!) ?? []) : []), [index, devices]);
  const match = useMemo(() => (single && device && port ? resolveMatch(index, device, port) : null), [index, single, device, port]);
  const bulkKeys = useMemo(() => {
    if (pairs.length < 2) return [];
    const wanted = new Set(pairs);
    return index.parsed.filter((id) => wanted.has(pairKey(id.device, id.port))).map((id) => id.key);
  }, [index, pairs]);

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
    setDevices([id.device]);
    setPairs([pairKey(id.device, id.port)]);
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

  // If selected devices/ports disappear after a sync, drop them gracefully.
  useEffect(() => {
    if (!snapshot) return;
    const stillThere = devices.filter((d) => index.portsByDevice.has(d));
    if (stillThere.length !== devices.length) setDevices(stillThere);
    else if (!hasUnsavedChanges) {
      const valid = pairs.filter((pair) => {
        const [d, p] = splitPair(pair);
        return index.portsByDevice.get(d)?.includes(p);
      });
      if (valid.length !== pairs.length) setPairs(valid);
    }
  }, [snapshot, index, devices, pairs, hasUnsavedChanges]);

  const deviceOptions = useMemo(
    () =>
      index.devices.map((d) => {
        const count = index.portsByDevice.get(d)?.length ?? 0;
        return { value: d, hint: `${count} port${count === 1 ? "" : "s"}` };
      }),
    [index],
  );
  const portOptions = useMemo(() => {
    const grouped = devices.length > 1;
    return index.devices
      .filter((d) => devices.includes(d))
      .flatMap((d) =>
        (index.portsByDevice.get(d) ?? []).map((p) => ({
          value: pairKey(d, p),
          label: p,
          group: grouped ? d : undefined,
          summary: grouped ? `${d} ${p}` : p,
        })),
      );
  }, [devices, index]);

  const recordCount = Object.keys(data).length;

  return (
    <DataStateGate>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Device Manager</h2>
            <p className="mt-1 text-sm text-fg-muted">
              Pick one robot and device port to edit a record, or several to update many records at once.
            </p>
          </div>
          <Button variant="primary" onClick={() => setAddOpen(true)} icon={<Plus className="size-4" />}>
            Add new device
          </Button>
        </div>

        <Card className="p-5">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label htmlFor="device-select" className="mb-1.5 block text-[13px] font-medium text-fg">
                Robot
              </label>
              <MultiSelect
                id="device-select"
                label="Robot"
                values={devices}
                options={deviceOptions}
                placeholder="Select robots"
                searchPlaceholder="Search robots…"
                emptyText="No robots match"
                icon={<Cpu className="size-4" />}
                onChange={(next) =>
                  guarded(() => {
                    setDevices(next);
                    // Keep only the ports of devices that are still selected.
                    setPairs((current) => current.filter((pair) => next.includes(splitPair(pair)[0])));
                    setChosenKey(null);
                  })
                }
              />
            </div>
            <div>
              <label htmlFor="port-select" className="mb-1.5 block text-[13px] font-medium text-fg">
                Device port
              </label>
              <MultiSelect
                id="port-select"
                label="Device port"
                values={pairs}
                options={portOptions}
                placeholder={devices.length ? (devices.length > 1 ? "Select device ports per robot" : "Select a device port") : "Select a robot first"}
                searchPlaceholder="Search device ports…"
                emptyText="No device ports match"
                icon={<Plug className="size-4" />}
                disabled={devices.length === 0}
                onChange={(next) =>
                  guarded(() => {
                    setPairs(next);
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
              <strong className="font-semibold text-fg">{index.devices.length}</strong> robots
            </span>
            {index.unparsed.length > 0 && (
              <span className="text-warning">
                {index.unparsed.length} record(s) don’t follow the naming convention — see All Devices
              </span>
            )}
          </div>
        </Card>

        <AnimatePresence mode="wait">
          {devices.length === 0 || pairs.length === 0 ? (
            <motion.div key="empty" {...fade}>
              <Card>
                <EmptyState
                  icon={<MousePointerClick className="size-5" />}
                  title={devices.length ? "Now select one or more device ports" : "Select a robot and device port"}
                  description={
                    devices.length === 1 && device
                      ? `${device} has ${ports.length} device port${ports.length === 1 ? "" : "s"}: ${ports.join(", ")}.`
                      : devices.length
                        ? `${devices.length} robots selected. Open Device port to pick the exact ports of each robot — they can differ per robot.`
                        : "The matching record from deviceInformation.json will appear here for editing. Select several to bulk edit."
                  }
                />
              </Card>
            </motion.div>
          ) : !single ? (
            <motion.div key="bulk" {...fade}>
              {bulkKeys.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={<SearchX className="size-5" />}
                    title="No records match this selection"
                    description="None of the selected device ports has a record."
                  />
                </Card>
              ) : (
                <BulkEditForm key={bulkKeys.join("|")} keys={bulkKeys} onCancel={() => guarded(() => setPairs([]))} />
              )}
            </motion.div>
          ) : match?.kind === "none" ? (
            <motion.div key="none" {...fade}>
              <Card>
                <EmptyState
                  icon={<SearchX className="size-5" />}
                  title="No existing record found for this Robot and Device port."
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
                    setPairs([]);
                    setChosenKey(null);
                  })
                }
                onDeleted={() => {
                  setPairs([]);
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
