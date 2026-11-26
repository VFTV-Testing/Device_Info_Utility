import { AlertTriangle, RefreshCw, Sparkles } from "lucide-react";
import { useEffect } from "react";
import { useRouteError } from "react-router-dom";
import { isStaleBuildError, reloadOnceForUpdate } from "../../lib/staleBuild";
import { Button, Card } from "../ui/primitives";

/** Shown instead of React Router's developer error screen when a page fails to open. */
export function RouteError() {
  const error = useRouteError();
  const stale = isStaleBuildError(error);

  // A tab opened before the latest deploy: get the new version without bothering the user.
  useEffect(() => {
    if (stale) reloadOnceForUpdate();
  }, [stale]);

  return (
    <div className="grid min-h-[60vh] place-items-center p-6">
      <Card className="max-w-md space-y-4 p-6 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
          {stale ? <Sparkles className="size-6" aria-hidden /> : <AlertTriangle className="size-6" aria-hidden />}
        </div>
        <h2 className="font-display text-xl font-bold text-fg">{stale ? "A new version of the site is available" : "Something went wrong"}</h2>
        <p className="text-sm text-fg-muted">
          {stale
            ? "The site was updated while this tab was open. Reload to continue — nothing you saved is lost."
            : "This page could not be shown. Reloading usually fixes it."}
        </p>
        {!stale && error instanceof Error && <p className="break-words font-mono text-xs text-fg-subtle">{error.message}</p>}
        <Button onClick={() => window.location.reload()} icon={<RefreshCw className="size-4" aria-hidden />}>
          Reload
        </Button>
      </Card>
    </div>
  );
}
