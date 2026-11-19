import type {
  AppConfigInfo,
  DeviceRecord,
  DevicesSnapshot,
  ImportMode,
  Mutation,
  RecordConflict,
  WriteResult,
} from "../../shared/types";

/** Error returned by the backend; `code` mirrors server/errors.ts. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get conflicts(): RecordConflict[] {
    const details = this.details as { conflicts?: RecordConflict[] } | undefined;
    return details?.conflicts ?? [];
  }

  get problems(): string[] {
    const details = this.details as { problems?: string[] } | undefined;
    return details?.problems ?? [];
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "NETWORK", "The server could not be reached. Check your network connection.");
  }

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? "HTTP_ERROR",
      error?.message ?? `The server responded with an error (${response.status}).`,
      error?.details,
    );
  }
  return payload as T;
}

export const api = {
  getConfig: () => request<AppConfigInfo>("GET", "/config"),
  getDevices: () => request<DevicesSnapshot>("GET", "/devices"),
  initialize: () => request<WriteResult>("POST", "/devices/initialize"),
  createRecord: (key: string, values: DeviceRecord) => request<WriteResult>("POST", "/devices/records", { key, values }),
  updateRecord: (key: string, base: DeviceRecord, values: DeviceRecord) =>
    request<WriteResult>("PUT", "/devices/records", { key, base, values }),
  deleteRecord: (key: string, base: DeviceRecord) => request<WriteResult>("DELETE", "/devices/records", { key, base }),
  importRecords: (mode: ImportMode, mutations: Mutation[]) =>
    request<WriteResult>("POST", "/devices/import", { mode, mutations }),
};

export type Api = typeof api;
