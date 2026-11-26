import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { parseDeviceId } from "../../../shared/deviceId";
import { useDeviceData } from "../../context/DeviceDataContext";
import { useEnvironment } from "../../context/EnvironmentContext";

/**
 * Keeps Device health in step with the device files: when this user's save adds devices
 * (Add device, Import), every new robot port gets a first Device health entry at once
 * ("OK · Device added"), so it has a history from day one. Ports that already have a history
 * are left alone, and deleting a device never removes its health history.
 * Devices added by others need nothing: Device health lists every port of the device file.
 */
export function DeviceHealthSync() {
  const { snapshot, lastCommit } = useDeviceData();
  const env = useEnvironment();
  const keysRef = useRef<Set<string> | null>(null);
  const handledRef = useRef(lastCommit);
  const addNewPorts = env?.addNewPorts;

  useEffect(() => {
    const keys = new Set(Object.keys(snapshot?.data ?? {}));
    const before = keysRef.current;
    keysRef.current = keys;
    // Only right after one of this user's own saves (a new commit), never on a background sync.
    if (!before || !lastCommit || lastCommit === handledRef.current) return;
    handledRef.current = lastCommit;
    if (!addNewPorts) return;
    const ports = [...keys]
      .filter((key) => !before.has(key))
      .map((key) => parseDeviceId(key))
      .filter((id) => id !== null)
      .map((id) => ({ robot: id.device, port: id.port }));
    if (!ports.length) return;
    addNewPorts(ports).then(
      (added) => {
        if (added) toast.success(`Device health: ${added} new port${added === 1 ? "" : "s"} added`, { description: "Marked OK · Device added" });
      },
      (error: unknown) =>
        toast.warning("The device was saved, but its Device health entry was not", {
          description: error instanceof Error ? error.message : "Add it from the Device health tab.",
        }),
    );
  }, [snapshot, lastCommit, addNewPorts]);

  return null;
}
