import { AnimatePresence, motion } from "framer-motion";
import { Activity, ArrowRight, ChevronRight, Cpu, Eye, GitBranch, KeyRound, Loader2, Lock, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button, FieldLabel, Input, Notice } from "../components/ui/primitives";
import { OAUTH_ENABLED, type GitHubTarget } from "../config";
import { useTheme } from "../hooks";
import { cn } from "../lib/cn";
import { completeGitHubLogin, startGitHubLogin } from "../services/githubOAuth";
import { clearStoredToken, readStoredCredentials, signInWithCredentials, signInWithToken, storeToken, type GitHubSession } from "../services/githubSession";
import { queueWelcome } from "../services/welcome";

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

interface ChoiceProps {
  index: number;
  icon: ReactNode;
  /** Colour scheme of the 3D card (see .si-* in styles/cards.css). */
  tone: "github" | "moderator" | "view";
  /** Small icons that pop forward when the card tilts. */
  tags: ReactNode[];
  who: string;
  title: string;
  description: string;
  action: string;
  ariaLabel: string;
  active?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

/**
 * One sign-in choice: a 3D glass card that tilts on hover or keyboard focus while its
 * bubbles rise around the icon. Adapted from Uiverse.io by Smit-Prajapati -
 * https://uiverse.io/Smit-Prajapati/smart-liger-5 (MIT License, Copyright (c) Smit-Prajapati (Smit Prajapati)).
 */
function Choice({ index, icon, tone, tags, who, title, description, action, ariaLabel, active, busy, disabled, onClick }: ChoiceProps) {
  return (
    <motion.button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={active}
      disabled={disabled || busy}
      onClick={onClick}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 + index * 0.07, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className={cn("si-parent", `si-${tone}`)}
    >
      <span className="si-card block">
        <span className="si-logo" aria-hidden>
          <span className="si-circle si-c1" />
          <span className="si-circle si-c2" />
          <span className="si-circle si-c3" />
          <span className="si-circle si-c4" />
          <span className="si-circle si-c5">{icon}</span>
        </span>
        <span className="si-glass" aria-hidden />
        <span className="si-content block">
          <span className="si-who">{who}</span>
          <span className="si-title">{title}</span>
          <span className="si-text">{description}</span>
        </span>
        <span className="si-bottom">
          <span className="si-tags" aria-hidden>
            {tags.map((tag, i) => (
              <span key={i} className="si-tag">
                {tag}
              </span>
            ))}
          </span>
          <span className="si-go">
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {action}
            <ChevronRight className="size-4" strokeWidth={3} aria-hidden />
          </span>
        </span>
      </span>
    </motion.button>
  );
}

export function SignInPage({
  target,
  onSignedIn,
  onViewOnly,
  githubEnabled = OAUTH_ENABLED,
}: {
  target: GitHubTarget;
  onSignedIn: (session: GitHubSession) => void;
  /** Opens the read-only view for people without a GitHub account. */
  onViewOnly?: () => void;
  githubEnabled?: boolean;
}) {
  useTheme(); // apply saved theme
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [githubBusy, setGithubBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [token, setToken] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [modName, setModName] = useState("");
  const started = useRef(false);
  const modReady = token.trim().length > 0 && modName.trim().length >= 2;

  // On load: finish a "Sign in with GitHub" redirect, or silently restore a saved session.
  useEffect(() => {
    if (started.current) return; // React StrictMode runs effects twice; the OAuth code is single-use
    started.current = true;
    (async () => {
      try {
        const fromGitHub = await completeGitHubLogin();
        if (fromGitHub) {
          const session = await signInWithCredentials(fromGitHub, target);
          queueWelcome(session.name || session.login, "github");
          onSignedIn(session);
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

  const signInWithGitHub = () => {
    setGithubBusy(true);
    setError(null);
    try {
      startGitHubLogin(remember);
    } catch (e) {
      setError((e as Error).message);
      setGithubBusy(false);
    }
  };

  /**
   * Moderators: their name plus a GitHub token as pass key. The token talks to api.github.com only,
   * so it works where the sign-in helper is blocked; the name is recorded on every change.
   */
  const submitToken = async (event: FormEvent) => {
    event.preventDefault();
    if (!modReady) return;
    setTokenBusy(true);
    setTokenError(null);
    try {
      const name = modName.trim();
      const session = await signInWithToken(token, target);
      storeToken(session.token, remember, name);
      queueWelcome(name, "passkey");
      onSignedIn({ ...session, remember, moderator: name });
    } catch (e) {
      setTokenError((e as Error).message);
      setTokenBusy(false);
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

  const choices = [
    {
      key: "github",
      show: true,
      icon: <GitHubMark className="size-6" />,
      tone: "github" as const,
      tags: [<Cpu key="d" className="size-4" />, <Activity key="e" className="size-4" />, <GitBranch key="c" className="size-4" />],
      who: "Team",
      title: "Sign in with GitHub",
      description: githubEnabled
        ? "Edit devices and device health. Changes are committed under your name."
        : "GitHub sign-in is not set up for this site.",
      action: "Continue",
      ariaLabel: "Sign in with GitHub",
      busy: githubBusy,
      disabled: !githubEnabled,
      onClick: signInWithGitHub,
    },
    {
      key: "token",
      show: true,
      icon: <KeyRound className="size-6" />,
      tone: "moderator" as const,
      tags: [<Cpu key="d" className="size-4" />, <Activity key="e" className="size-4" />],
      who: "Moderators",
      title: "Moderator pass key",
      description: "Works on corporate laptops. Edit devices and update Device health with your pass key.",
      action: tokenOpen ? "Enter your pass key below" : "Use the pass key",
      ariaLabel: "Sign in as moderator",
      active: tokenOpen,
      onClick: () => setTokenOpen((open) => !open),
    },
    {
      key: "view",
      show: Boolean(onViewOnly),
      icon: <Eye className="size-6" />,
      tone: "view" as const,
      tags: [<Lock key="r" className="size-4" />],
      who: "Everyone",
      title: "View only",
      description: "No account needed. Browse every robot, device and its health status — read only.",
      action: "Open the view",
      ariaLabel: "View without signing in",
      onClick: () => onViewOnly?.(),
    },
  ].filter((c) => c.show);

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-4xl">
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mb-8 flex flex-col items-center gap-3 text-center"
        >
          <motion.span
            className="grid size-14 place-items-center rounded-2xl bg-[linear-gradient(135deg,#6366f1,#22d3ee)] text-white shadow-[0_10px_30px_var(--primary-glow)]"
            animate={{ rotate: [0, -4, 4, 0] }}
            transition={{ duration: 1.2, delay: 0.3, ease: "easeInOut" }}
          >
            <Cpu className="size-7" aria-hidden />
          </motion.span>
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Device Information Manager</h1>
          <p className="text-sm text-fg-muted">How would you like to continue?</p>
        </motion.header>

        {error && (
          <Notice tone="danger" title="Sign-in failed" className="mb-5">
            {error}
          </Notice>
        )}

        <div className={cn("grid grid-cols-1 gap-6", choices.length === 3 ? "md:grid-cols-3" : choices.length === 2 ? "md:grid-cols-2" : "")}>
          {choices.map(({ key, show: _show, ...props }, i) => (
            <Choice key={key} index={i} {...props} />
          ))}
        </div>

        <AnimatePresence initial={false}>
          {tokenOpen && (
            <motion.div
              key="token-form"
              initial={{ opacity: 0, height: 0, y: -8 }}
              animate={{ opacity: 1, height: "auto", y: 0 }}
              exit={{ opacity: 0, height: 0, y: -8 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className="glass mt-4 grid gap-4 rounded-3xl border p-5 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="flex items-center gap-2 font-display text-base font-bold">
                      <KeyRound className="size-4 text-accent" aria-hidden /> Moderator sign-in
                    </h2>
                    <p className="mt-0.5 text-[13px] text-fg-muted">
                      Your name is saved with every change you make, so the team can see who fixed what.
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" aria-label="Close moderator sign-in" onClick={() => setTokenOpen(false)}>
                    <X className="size-4" />
                  </Button>
                </div>
                {tokenError && (
                  <Notice tone="danger" title="Could not sign in">
                    {tokenError}
                  </Notice>
                )}
                <form onSubmit={(e) => void submitToken(e)} aria-label="Moderator sign-in" className="grid gap-3 sm:grid-cols-[1fr_1.3fr_auto] sm:items-end">
                  <div>
                    <FieldLabel htmlFor="moderator-name">Your name</FieldLabel>
                    <Input id="moderator-name" value={modName} maxLength={60} autoComplete="name" autoFocus onChange={(e) => setModName(e.target.value)} placeholder="e.g. Priya" />
                  </div>
                  <div>
                    <FieldLabel htmlFor="gh-token">Pass key</FieldLabel>
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
                  <Button type="submit" variant="primary" className="h-10" loading={tokenBusy} disabled={!modReady} icon={<ArrowRight className="size-4" />}>
                    Continue
                  </Button>
                </form>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35 }}
          className="mt-6 flex flex-col items-center gap-2 text-center"
        >
          <label className="inline-flex items-center gap-2 text-[13px] text-fg-muted">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 accent-[var(--primary-from)]" />
            Keep me signed in on this device <span className="text-fg-subtle">(only on your own computer)</span>
          </label>
          <p className="inline-flex items-center gap-1.5 text-xs text-fg-subtle">
            <ShieldCheck className="size-3.5" aria-hidden /> Your sign-in is stored only in this browser.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
