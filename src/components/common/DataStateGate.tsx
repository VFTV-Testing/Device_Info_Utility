import { AlertTriangle, Eye, FilePlus2, Lock, RefreshCw, WifiOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useDeviceData } from "../../context/DeviceDataContext";
import { formatTime } from "../../lib/cn";
import { ApiError } from "../../services/api";
import { ConfirmDialog } from "../ui/Dialog";
import { Button, Card, Notice, Skeleton } from "../ui/primitives";

export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-56" />
      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
        </div>
      </Card>
      <Card className="space-y-3 p-5">
        <Skeleton className="h-5 w-72" />
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      </Card>
    </div>
  );
}

/**
 * Shows loading / connection-failed / file-missing states.
 * When a refresh fails but data was loaded before, the last synced data stays
 * visible with a clear warning — it is never presented as current.
 */
export function DataStateGate({ children }: { children: ReactNode }) {
  const { connection, error, snapshot, refresh, syncing, initializeFile, writing, config } = useDeviceData();
  const [confirmInit, setConfirmInit] = useState(false);

  if (connection === "loading" && !snapshot) return <PageSkeleton />;

  if (connection === "missing") {
    return (
      <>
        <Card className="mx-auto max-w-xl p-8 text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-warning-soft text-warning">
            <FilePlus2 className="size-6" aria-hidden />
          </div>
          <h2 className="text-lg font-semibold">Device file not found</h2>
          <p className="mt-2 text-sm text-fg-muted">
            {config?.location ? <code className="text-xs">{config.location}</code> : "The configured file"} does not exist yet.
            You can initialise it as an empty JSON object <code>{"{}"}</code>. An existing file is never replaced.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Button variant="secondary" onClick={() => void refresh()} loading={syncing} icon={<RefreshCw className="size-4" />}>
              Check again
            </Button>
            <Button variant="primary" onClick={() => setConfirmInit(true)} icon={<FilePlus2 className="size-4" />}>
              Initialise file
            </Button>
          </div>
        </Card>
        <ConfirmDialog
          open={confirmInit}
          onOpenChange={setConfirmInit}
          title="Initialise device file?"
          description="This commits a new file containing {} to the configured repository and branch."
          confirmLabel="Create file"
          loading={writing}
          onConfirm={async () => {
            try {
              const result = await initializeFile();
              toast.success("Device file created", { description: `Commit ${result.commit.sha.slice(0, 7)}` });
              setConfirmInit(false);
            } catch (e) {
              toast.error("Could not create the file", { description: (e as ApiError).message });
              setConfirmInit(false);
              void refresh();
            }
          }}
        />
      </>
    );
  }

  if (connection === "error" && !snapshot) {
    const invalid = error?.code === "FILE_INVALID";
    return (
      <Card className="mx-auto max-w-xl p-8 text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-danger-soft text-danger">
          {invalid ? <AlertTriangle className="size-6" aria-hidden /> : <WifiOff className="size-6" aria-hidden />}
        </div>
        <h2 className="text-lg font-semibold">{invalid ? "The device file is not valid" : "Could not load device information"}</h2>
        <p className="mt-2 text-sm text-fg-muted">{error?.message}</p>
        {error && error.problems.length > 0 && (
          <ul className="mx-auto mt-4 max-h-48 max-w-md overflow-y-auto rounded-lg border border-border bg-surface-2 p-3 text-left text-xs text-fg-muted">
            {error.problems.map((p) => (
              <li key={p} className="py-0.5">
                • {p}
              </li>
            ))}
          </ul>
        )}
        <Button className="mt-6" variant="primary" onClick={() => void refresh()} loading={syncing} icon={<RefreshCw className="size-4" />}>
          Try again
        </Button>
      </Card>
    );
  }

  return (
    <>
      {config?.moderator ? (
        <Notice tone="accent" icon={<Eye className="size-4" />} title={`Signed in as ${config.moderator} (moderator)`} className="mb-5">
          You can update the <strong>Environment</strong> status. Device information and setup info are read only.
        </Notice>
      ) : config?.viewOnly ? (
        <Notice tone="accent" icon={<Eye className="size-4" />} title="You are viewing without signing in" className="mb-5">
          Everything is read only and refreshes automatically (changes appear within about 5 minutes). Team members with access to{" "}
          <code className="text-xs">{config.location}</code> can use <strong>Sign in to edit</strong> at the top.
        </Notice>
      ) : config?.readOnly && (
        <Notice tone="warning" icon={<Lock className="size-4" />} title="Read-only — changes cannot be saved" className="mb-5">
          {config.authEnabled && config.user ? (
            <>
              Your GitHub account <strong>{config.user}</strong> does not have write access to <code className="text-xs">{config.location}</code>. Ask a
              repository owner to add you as a collaborator with <strong>Write</strong> permission, then sign out and in again.
            </>
          ) : (
            <>
              The server has no GitHub credentials configured, so it can read <code className="text-xs">{config.location}</code> but cannot commit to
              it. Configure a GitHub App or a fine-grained token on the server to enable saving.
            </>
          )}
        </Notice>
      )}
      {connection === "error" && snapshot && (
        <Notice
          tone="danger"
          icon={<WifiOff className="size-4" />}
          title="Connection failed — showing the last synchronised data"
          className="mb-5"
          actions={
            <Button size="sm" onClick={() => void refresh()} loading={syncing} icon={<RefreshCw className="size-3.5" />}>
              Retry
            </Button>
          }
        >
          {error?.message} Last successful sync at {formatTime(snapshot.fetchedAt)}. Saving is still checked against GitHub.
        </Notice>
      )}
      {children}
    </>
  );
}
