import type { RecordConflict } from "./types";

export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_FAILED"
  | "UNAUTHORIZED"
  | "GITHUB_AUTH_FAILED"
  | "GITHUB_PERMISSION_DENIED"
  | "GITHUB_RATE_LIMITED"
  | "GITHUB_NOT_FOUND"
  | "GITHUB_UNAVAILABLE"
  | "GITHUB_SHA_CONFLICT"
  | "FILE_MISSING"
  | "FILE_EXISTS"
  | "FILE_INVALID"
  | "RECORD_CONFLICT"
  | "NO_CHANGES"
  | "READ_ONLY"
  | "NOT_FOUND"
  | "CONFIG_ERROR"
  | "INTERNAL";

/**
 * Error that is safe to show to users. Messages must never contain tokens,
 * private keys or stack traces.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class RecordConflictError extends AppError {
  constructor(public readonly conflicts: RecordConflict[]) {
    super(409, "RECORD_CONFLICT", describeConflicts(conflicts), { conflicts });
  }
}

function describeConflicts(conflicts: RecordConflict[]): string {
  const first = conflicts[0];
  if (!first) return "The data changed in GitHub.";
  const more = conflicts.length > 1 ? ` (and ${conflicts.length - 1} more)` : "";
  switch (first.reason) {
    case "missing":
      return `"${first.key}" no longer exists in GitHub${more}. Someone may have deleted it.`;
    case "modified":
      return `"${first.key}" was changed in GitHub by someone else since you loaded it${more}.`;
    case "exists":
      return `"${first.key}" already exists in GitHub${more}. Existing records are never overwritten when adding.`;
  }
}
