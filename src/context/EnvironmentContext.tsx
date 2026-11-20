import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { naturalCompare } from "../../shared/deviceId";
import type { EnvEntryInput, EnvWriteResult } from "../../shared/environment";
import { useBeforeUnload } from "../hooks";
import { ApiError } from "../services/api";
import type { EnvApi, EnvLoadResult } from "../services/environmentClient";

/** Pending (not yet pushed) updates, one per robot port, keyed "ROBOT|PORT". */
export type PendingUpdates = Record<string, EnvEntryInput>;

export const pendingId = (robot: string, port: string) => `${robot}|${port}`;

interface EnvironmentValue {
  data: EnvLoadResult | null;
  /** True during the first load (nothing to show yet). */
  loading: boolean;
  /** True while any read runs (first load or a refresh). */
  syncing: boolean;
  /** True while pending updates are being pushed. */
  writing: boolean;
  error: ApiError | null;
  refresh: () => Promise<void>;
  /** Updates collected locally, waiting for "Push". */
  pending: PendingUpdates;
  /** Adds (or replaces) the pending update for a port. Nothing is saved yet. */
  stage: (input: EnvEntryInput) => void;
  unstage: (robot: string, port: string) => void;
  discardAll: () => void;
  /** Saves every pending update to GitHub in ONE commit, then clears them. */
  pushPending: () => Promise<EnvWriteResult>;
}

const EnvironmentContext = createContext<EnvironmentValue | null>(null);
const PENDING_KEY = "dim-env-pending";

function readPending(): PendingUpdates {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as PendingUpdates) : {};
  } catch {
    return {};
  }
}

/**
 * Environment tab data. Loaded only when the tab is opened (and refreshed while it is open),
 * so it never adds requests for people who don't use it. Updates are collected as "pending"
 * and saved together with one Push.
 */
export function EnvironmentProvider({ client, children }: { client: EnvApi; children: ReactNode }) {
  const [data, setData] = useState<EnvLoadResult | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  // Kept for this browser tab, so switching tabs or reloading does not lose unpushed work.
  const [pending, setPending] = useState<PendingUpdates>(readPending);
  const busy = useRef(false);

  useEffect(() => {
    try {
      if (Object.keys(pending).length) sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
      else sessionStorage.removeItem(PENDING_KEY);
    } catch {
      /* storage unavailable — pending updates live until the page closes */
    }
  }, [pending]);
  useBeforeUnload(Object.keys(pending).length > 0);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setSyncing(true);
    try {
      setData(await client.load());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "UNKNOWN", "The environment status could not be loaded."));
    } finally {
      busy.current = false;
      setSyncing(false);
    }
  }, [client]);

  const stage = useCallback((input: EnvEntryInput) => {
    setPending((p) => ({ ...p, [pendingId(input.robot, input.port)]: { ...input, note: input.note.trim() } }));
  }, []);

  const unstage = useCallback((robot: string, port: string) => {
    setPending((p) => {
      const next = { ...p };
      delete next[pendingId(robot, port)];
      return next;
    });
  }, []);

  const discardAll = useCallback(() => setPending({}), []);

  const pushPending = useCallback(async () => {
    // Natural robot/port order, so the commit and history read the same way every time.
    const inputs = Object.entries(pending)
      .sort(([a], [b]) => naturalCompare(a, b))
      .map(([, input]) => input);
    if (!inputs.length) throw new ApiError(400, "VALIDATION_FAILED", "There are no pending updates to push.");
    setWriting(true);
    try {
      const result = await client.addEntries(inputs);
      setData((prev) => ({ ...result, readOnly: prev?.readOnly ?? false, location: prev?.location ?? "" }));
      setError(null);
      setPending({});
      return result;
    } finally {
      setWriting(false);
    }
  }, [client, pending]);

  const value = useMemo<EnvironmentValue>(
    () => ({ data, loading: !data && !error, syncing, writing, error, refresh, pending, stage, unstage, discardAll, pushPending }),
    [data, syncing, writing, error, refresh, pending, stage, unstage, discardAll, pushPending],
  );
  return <EnvironmentContext.Provider value={value}>{children}</EnvironmentContext.Provider>;
}

export function useEnvironment(): EnvironmentValue | null {
  return useContext(EnvironmentContext);
}
