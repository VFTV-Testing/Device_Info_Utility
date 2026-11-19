import { motion } from "framer-motion";
import { ChevronDown, Cpu, ExternalLink, KeyRound, Loader2, LogIn, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Card, FieldLabel, Input, Notice } from "../components/ui/primitives";
import { OAUTH_ENABLED, type GitHubTarget } from "../config";
import { useTheme } from "../hooks";
import { cn } from "../lib/cn";
import { completeGitHubLogin, startGitHubLogin } from "../services/githubOAuth";
import { clearStoredToken, readStoredCredentials, signInWithCredentials, signInWithToken, storeToken, type GitHubSession } from "../services/githubSession";

const TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function SignInPage({ target, onSignedIn }: { target: GitHubTarget; onSignedIn: (session: GitHubSession) => void }) {
  useTheme(); // apply saved theme
  const [token, setToken] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [showToken, setShowToken] = useState(!OAUTH_ENABLED);
  const started = useRef(false);

  // On load: finish a "Sign in with GitHub" redirect, or silently restore a saved session.
  useEffect(() => {
    if (started.current) return; // React StrictMode runs effects twice; the OAuth code is single-use
    started.current = true;
    (async () => {
      try {
        const fromGitHub = await completeGitHubLogin();
        if (fromGitHub) {
          onSignedIn(await signInWithCredentials(fromGitHub, target));
          return;
        }
        const stored = readStoredCredentials();
        if (stored) {
          onSignedIn(await signInWithCredentials(stored, target));
          return;
        }
      } catch (e) {
        clearStoredToken();
        setError((e as Error).message);
      }
      setRestoring(false);
    })();
  }, [target, onSignedIn]);

  const submitToken = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await signInWithToken(token, target);
      storeToken(session.token, remember);
      onSignedIn(session);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  if (restoring) {
    return (
      <div className="grid min-h-dvh place-items-center text-sm text-fg-muted">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Signing in…
        </span>
      </div>
    );
  }

  const rememberBox = (
    <label className="flex items-start gap-2 text-[13px] text-fg-muted">
      <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
      <span>
        Keep me signed in on this device <span className="text-fg-subtle">(only on your own computer)</span>
      </span>
    </label>
  );

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="w-full max-w-lg">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-accent text-accent-fg shadow-card">
            <Cpu className="size-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Device Information Manager</h1>
            <p className="text-xs text-fg-muted">
              {target.owner}/{target.repo} · {target.branch} · {target.filePath}
            </p>
          </div>
        </div>

        {error && (
          <Notice tone="danger" title="Sign-in failed" className="mb-4">
            {error}
          </Notice>
        )}

        {OAUTH_ENABLED && (
          <Card className="p-6">
            <h2 className="text-base font-semibold">Sign in</h2>
            <p className="mt-1 text-[13px] text-fg-muted">
              Use your GitHub account. Changes are committed under your name; only collaborators with write access to{" "}
              <strong className="text-fg">
                {target.owner}/{target.repo}
              </strong>{" "}
              can save.
            </p>
            <div className="mt-5 space-y-4">
              {rememberBox}
              <Button
                variant="primary"
                className="h-11 w-full bg-[#1f2328] text-white hover:bg-[#32383f] dark:bg-white dark:text-[#1f2328] dark:hover:bg-white/90"
                loading={busy}
                icon={<GitHubMark className="size-5" />}
                onClick={() => {
                  setBusy(true);
                  try {
                    startGitHubLogin(remember);
                  } catch (e) {
                    setError((e as Error).message);
                    setBusy(false);
                  }
                }}
              >
                Sign in with GitHub
              </Button>
            </div>
          </Card>
        )}

        <Card className={cn("p-6", OAUTH_ENABLED && "mt-4")}>
          {OAUTH_ENABLED ? (
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              aria-expanded={showToken}
              className="flex w-full items-center justify-between text-left text-[13px] font-medium text-fg-muted hover:text-fg"
            >
              <span className="flex items-center gap-2">
                <KeyRound className="size-4" /> Use a personal access token instead
              </span>
              <ChevronDown className={cn("size-4 transition-transform", showToken && "rotate-180")} />
            </button>
          ) : (
            <>
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <KeyRound className="size-4 text-accent" /> Sign in with your GitHub token
              </h2>
              <p className="mt-1 text-[13px] text-fg-muted">
                Changes are committed to GitHub under your own account. Only collaborators with write access to{" "}
                <strong className="text-fg">
                  {target.owner}/{target.repo}
                </strong>{" "}
                can save.
              </p>
            </>
          )}

          {showToken && (
            <>
              <form onSubmit={submitToken} className="mt-5 space-y-4">
                <div>
                  <FieldLabel htmlFor="gh-token">Personal access token</FieldLabel>
                  <Input
                    id="gh-token"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="github_pat_…"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="font-mono"
                  />
                </div>
                {rememberBox}
                <Button type="submit" variant={OAUTH_ENABLED ? "secondary" : "primary"} className="w-full" loading={busy} icon={<LogIn className="size-4" />}>
                  Sign in with token
                </Button>
              </form>
              <div className="mt-5 border-t border-border pt-4 text-[13px] text-fg-muted">
                <p className="mb-2 flex items-center gap-2 font-medium text-fg">
                  <ShieldCheck className="size-4 text-success" /> Create a token (about 2 minutes)
                </p>
                <ol className="list-decimal space-y-1 pl-5">
                  <li>
                    Open{" "}
                    <a href={TOKEN_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-accent hover:underline">
                      GitHub → New fine-grained token <ExternalLink className="size-3" />
                    </a>
                    .
                  </li>
                  <li>
                    <strong className="text-fg">Resource owner:</strong> {target.owner}.
                  </li>
                  <li>
                    <strong className="text-fg">Repository access:</strong> Only select repositories → <strong className="text-fg">{target.repo}</strong>.
                  </li>
                  <li>
                    <strong className="text-fg">Permissions → Contents:</strong> Read and write.
                  </li>
                  <li>Generate, copy and paste it above. Treat it like a password.</li>
                </ol>
              </div>
            </>
          )}
        </Card>

        <p className="mt-4 text-center text-xs text-fg-subtle">Your sign-in is used only to talk to GitHub and is stored only in this browser.</p>
      </motion.div>
    </div>
  );
}
