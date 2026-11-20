import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { buildDeviceIndex, type DeviceIndex } from "../../shared/deviceId";
import { recordsEqual } from "../../shared/validation";
import type {
  AppConfigInfo,
  CommitInfo,
  DeviceData,
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

/** Auto-sync choices in milliseconds; 0 turns it off. */
export const AUTO_SYNC_OPTIONS = [0, 30_000, 60_000, 120_000, 300_000] as const;
export const DEFAULT_AUTO_SYNC_MS = 60_000;
const AUTO_SYNC_KEY = "dim-auto-sync";
/** Coming back to the tab re-syncs if the data is older than this. */
const FOCUS_SYNC_AFTER_MS = 15_000;

function readAutoSync(): number {
  try {
    const raw = localStorage.getItem(AUTO_SYNC_KEY);
    const stored = Number(raw);
    return raw !== null && (AUTO_SYNC_OPTIONS as readonly number[]).includes(stored) ? stored : DEFAULT_AUTO_SYNC_MS;
  } catch {
    return DEFAULT_AUTO_SYNC_MS;
  }
}

export interface DataDiff {
  added: number;
  removed: number;
  changed: number;
}

export function diffData(before: DeviceData, after: DeviceData): DataDiff {
  let added = 0;
  let changed = 0;
  for (const [key, record] of Object.entries(after)) {
    const old = before[key];
    if (!old) added++;
    else if (!recordsEqual(old, record)) changed++;
  }
  const removed = Object.keys(before).filter((key) => !(key in after)).length;
  return { added, removed, changed };
}

function describeDiff({ added, removed, changed }: DataDiff): string {
  const parts = [changed && `${changed} changed`, added && `${added} added`, removed && `${removed} removed`].filter(Boolean);
  return parts.length ? parts.join(", ") : "File metadata changed";
}

export interface RecordUpdate {
  key: string;
  base: DeviceRecord;
  values: DeviceRecord;
}

interface RefreshOptions {
  /** Background sync: no loading state, and a failure never replaces the page with an error screen. */
  background?: boolean;
}

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
  refresh: (options?: RefreshOptions) => Promise<DevicesSnapshot | null>;
  /** When the data was last confirmed against GitHub (read or write). */
  lastSyncedAt: string | null;
  /** True while a silent background sync is running. */
  backgroundSyncing: boolean;
  /** Last background sync failure (the page keeps showing the last good data). */
  syncError: string | null;
  autoSyncMs: number;
  setAutoSyncMs: (ms: number) => void;
  initializeFile: () => Promise<WriteResult>;
  createRecord: (key: string, values: DeviceRecord) => Promise<WriteResult>;
  updateRecord: (key: string, base: DeviceRecord, values: DeviceRecord) => Promise<WriteResult>;
  deleteRecord: (key: string, base: DeviceRecord) => Promise<WriteResult>;
  /** Updates several records in ONE commit (all or nothing). */
  updateRecords: (updates: RecordUpdate[]) => Promise<WriteResult>;
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
  const [backgroundSyncing, setBackgroundSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [autoSyncMs, setAutoSyncState] = useState<number>(readAutoSync);
  const writeLock = useRef(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Latest snapshot, readable from timers without re-creating them. */
  const snapshotRef = useRef<DevicesSnapshot | null>(null);
  const busyRef = useRef(false);
  const pendingRef = useRef(0);
  pendingRef.current = pending;

  /** Stores a new snapshot; announces changes made by someone else (never our own writes). */
  const acceptSnapshot = useCallback((next: DevicesSnapshot, announce: boolean) => {
    const previous = snapshotRef.current;
    snapshotRef.current = next;
    setSnapshot(next);
    if (announce && previous && previous.version !== next.version) {
      toast.info("Updated from GitHub", { description: describeDiff(diffData(previous.data, next.data)) });
    }
  }, []);

  const setAutoSyncMs = useCallback((ms: number) => {
    setAutoSyncState(ms);
    try {
      localStorage.setItem(AUTO_SYNC_KEY, String(ms));
    } catch {
      /* storage unavailable — the choice still applies to this session */
    }
  }, []);

  const track = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    setPending((n) => n + 1);
    try {
      return await work();
    } finally {
      setPending((n) => n - 1);
    }
  }, []);

  const refresh = useCallback(
    async ({ background = false }: RefreshOptions = {}): Promise<DevicesSnapshot | null> => {
      if (background) {
        busyRef.current = true;
        setBackgroundSyncing(true);
        try {
          const data = await client.getDevices();
          acceptSnapshot(data, true);
          setConnection("connected");
          setError(null);
          setSyncError(null);
          return data;
        } catch (e) {
          setSyncError(e instanceof Error ? e.message : "Background sync failed.");
          return null;
        } finally {
          busyRef.current = false;
          setBackgroundSyncing(false);
        }
      }
      return track(async () => {
        try {
          const [cfg, data] = await Promise.all([client.getConfig(), client.getDevices()]);
          setConfig(cfg);
          acceptSnapshot(data, true);
          setConnection("connected");
          setError(null);
          setSyncError(null);
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
    },
    [client, track, acceptSnapshot],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Auto-sync: poll GitHub on the chosen interval. Skipped while the tab is hidden or another read/write runs.
  const backgroundSync = useCallback(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    if (writeLock.current || busyRef.current || pendingRef.current > 0 || !snapshotRef.current) return;
    void refresh({ background: true });
  }, [refresh]);

  useEffect(() => {
    if (!autoSyncMs) return;
    const id = setInterval(backgroundSync, autoSyncMs);
    return () => clearInterval(id);
  }, [autoSyncMs, backgroundSync]);

  // Returning to the tab → catch up straight away if the data is getting old.
  useEffect(() => {
    if (!autoSyncMs) return;
    const onVisible = () => {
      if (document.hidden) return;
      const last = snapshotRef.current?.fetchedAt;
      if (!last || Date.now() - new Date(last).getTime() > FOCUS_SYNC_AFTER_MS) backgroundSync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [autoSyncMs, backgroundSync]);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  /** Runs a write; success is reported only after the server confirms the GitHub commit. */
  const write = useCallback(
    async (work: () => Promise<WriteResult>): Promise<WriteResult> => {
      if (writeLock.current) throw new ApiError(0, "BUSY", "Another save is still in progress. Please wait.");
      writeLock.current = true;
      setWriting(true);
      try {
        const result = await track(work);
        acceptSnapshot({ data: result.data, version: result.version, fetchedAt: result.fetchedAt }, false);
        setSyncError(null);
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
    [track, acceptSnapshot],
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
    lastSyncedAt: snapshot?.fetchedAt ?? null,
    backgroundSyncing,
    syncError,
    autoSyncMs,
    setAutoSyncMs,
    initializeFile: () => write(() => client.initialize()),
    createRecord: (key, values) => write(() => client.createRecord(key, values)),
    updateRecord: (key, base, values) => write(() => client.updateRecord(key, base, values)),
    deleteRecord: (key, base) => write(() => client.deleteRecord(key, base)),
    updateRecords: (updates) =>
      write(() =>
        client.importRecords(
          "update-existing",
          updates.map((u) => ({ type: "update" as const, key: u.key, base: u.base, values: u.values })),
        ),
      ),
    importRecords: (mode, mutations) => write(() => client.importRecords(mode, mutations)),
  };

  return <DeviceDataContext.Provider value={value}>{children}</DeviceDataContext.Provider>;
}

export function useDeviceData(): DeviceDataValue {
  const value = useContext(DeviceDataContext);
  if (!value) throw new Error("useDeviceData must be used inside <DeviceDataProvider>");
  return value;
}
