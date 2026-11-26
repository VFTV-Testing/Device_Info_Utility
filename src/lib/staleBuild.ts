/**
 * After a deploy, a tab opened earlier still asks for the old page files (their names change
 * with every build, and the old ones are removed). Loading the page again picks up the new
 * version. This reloads once by itself; if that does not help, the error page offers a button.
 */
const RELOAD_KEY = "dim-reloaded-for-update";

export function isStaleBuildError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /dynamically imported module|Importing a module script failed|Loading chunk|preload/i.test(message);
}

/** Reloads the page unless it was already reloaded for this a minute ago. True when reloading. */
export function reloadOnceForUpdate(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (last && Date.now() - last < 60_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false; // no storage: let the error page offer the reload instead of risking a loop
  }
  window.location.reload();
  return true;
}
