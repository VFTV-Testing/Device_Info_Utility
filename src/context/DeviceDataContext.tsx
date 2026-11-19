import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buildDeviceIndex, type DeviceIndex } from "../../shared/deviceId";
import type {
  AppConfigInfo,
  CommitInfo,
  DeviceRecord,
  DevicesSnapshot,
  ImportMode,
  Mutation,
  WriteResult,
} from "../../shared/types";
import { api as defaultApi, ApiError, type Api } from "../services/api";

export type ConnectionState = "loading" | "connected" | "error" | "missing";

export type SyncLabel =
  | "Connecting"
  | "Syncing"
  | "Connected"
  | "Saved to GitHub"
  | "Saved locally"
  | "Unsaved Changes"
  | "Conflict Detected"
  | "Connection Failed"
  | "File Missing"
  | "Invalid File";

interface DeviceDataValue {
  config: AppConfigInfo | null;
  snapshot: DevicesSnapshot | null;
  index: DeviceIndex;
  connection: ConnectionState;
  error: ApiError | null;
  /** True while any read or write is in flight. */
  syncing: boolean;
  /** True while a write is in flight — used to disable submit buttons. */
  writing: boolean;
  lastCommit: CommitInfo | null;
  syncLabel: SyncLabel;
  hasUnsavedChanges: boolean;
  setHasUnsavedChanges: (value: boolean) => void;
  conflictActive: boolean;
  setConflictActive: (value: boolean) => void;
  refresh: () => Promise<DevicesSnapshot | null>;
  initializeFile: () => Promise<WriteResult>;
  createRecord: (key: string, values: DeviceRecord) => Promise<WriteResult>;
  updateRecord: (key: string, base: DeviceRecord, values: DeviceRecord) => Promise<WriteResult>;
  deleteRecord: (key: string, base: DeviceRecord) => Promise<WriteResult>;
  importRecords: (mode: ImportMode, mutations: Mutation[]) => Promise<WriteResult>;
}

const DeviceDataContext = createContext<DeviceDataValue | null>(null);

const EMPTY_INDEX = buildDeviceIndex({});

export function DeviceDataProvider({ children, client = defaultApi }: { children: ReactNode; client?: Api }) {
  const [config, setConfig] = useState<AppConfigInfo | null>(null);
  const [snapshot, setSnapshot] = useState<DevicesSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("loading");
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(0);
  const [writing, setWriting] = useState(false);
  const [lastCommit, setLastCommit] = useState<CommitInfo | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [conflictActive, setConflictActive] = useState(false);
  const writeLock = useRef(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const track = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    setPending((n) => n + 1);
    try {
      return await work();
    } finally {
      setPending((n) => n - 1);
    }
  }, []);

  const refresh = useCallback(async (): Promise<DevicesSnapshot | null> => {
    return track(async () => {
      try {
        const [cfg, data] = await Promise.all([client.getConfig(), client.getDevices()]);
        setConfig(cfg);
        setSnapshot(data);
        setConnection("connected");
        setError(null);
        return data;
      } catch (e) {
        const apiError = e instanceof ApiError ? e : new ApiError(0, "UNKNOWN", "Unexpected error while loading data.");
        setError(apiError);
        if (apiError.code === "FILE_MISSING") {
          setSnapshot(null);
          setConnection("missing");
          client.getConfig().then(setConfig, () => undefined);
        } else {
          setConnection("error");
        }
        return null;
      }
    });
  }, [client, track]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  /** Runs a write; success is reported only after the server confirms the GitHub commit. */
  const write = useCallback(
    async (work: () => Promise<WriteResult>): Promise<WriteResult> => {
      if (writeLock.current) throw new ApiError(0, "BUSY", "Another save is still in progress. Please wait.");
      writeLock.current = true;
      setWriting(true);
      try {
        const result = await track(work);
        setSnapshot({ data: result.data, version: result.version, fetchedAt: result.fetchedAt });
        setConnection("connected");
        setError(null);
        setLastCommit(result.commit);
        setConflictActive(false);
        setJustSaved(true);
        clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setJustSaved(false), 6000);
        return result;
      } catch (e) {
        if (e instanceof ApiError && e.code === "RECORD_CONFLICT") setConflictActive(true);
        throw e;
      } finally {
        writeLock.current = false;
        setWriting(false);
      }
    },
    [track],
  );

  const index = useMemo(() => (snapshot ? buildDeviceIndex(snapshot.data) : EMPTY_INDEX), [snapshot]);

  const syncLabel: SyncLabel = (() => {
    if (connection === "loading") return "Connecting";
    if (pending > 0) return "Syncing";
    if (connection === "missing") return "File Missing";
    if (connection === "error") return error?.code === "FILE_INVALID" ? "Invalid File" : "Connection Failed";
    if (conflictActive) return "Conflict Detected";
    if (hasUnsavedChanges) return "Unsaved Changes";
    if (justSaved) return config?.storage === "local" ? "Saved locally" : "Saved to GitHub";
    return "Connected";
  })();

  const value: DeviceDataValue = {
    config,
    snapshot,
    index,
    connection,
    error,
    syncing: pending > 0,
    writing,
    lastCommit,
    syncLabel,
    hasUnsavedChanges,
    setHasUnsavedChanges,
    conflictActive,
    setConflictActive,
    refresh,
    initializeFile: () => write(() => client.initialize()),
    createRecord: (key, values) => write(() => client.createRecord(key, values)),
    updateRecord: (key, base, values) => write(() => client.updateRecord(key, base, values)),
    deleteRecord: (key, base) => write(() => client.deleteRecord(key, base)),
    importRecords: (mode, mutations) => write(() => client.importRecords(mode, mutations)),
  };

  return <DeviceDataContext.Provider value={value}>{children}</DeviceDataContext.Provider>;
}

export function useDeviceData(): DeviceDataValue {
  const value = useContext(DeviceDataContext);
  if (!value) throw new Error("useDeviceData must be used inside <DeviceDataProvider>");
  return value;
}
