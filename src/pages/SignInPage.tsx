import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Cpu, Eye, KeyRound, Loader2, ShieldCheck, UserCheck, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { Button, FieldLabel, Input, Notice } from "../components/ui/primitives";
import { OAUTH_ENABLED, type GitHubTarget } from "../config";
import { useTheme } from "../hooks";
import { cn } from "../lib/cn";
import { completeGitHubLogin, startGitHubLogin } from "../services/githubOAuth";
import { clearStoredToken, readStoredCredentials, signInWithCredentials, type GitHubSession } from "../services/githubSession";
import { MODERATOR_ENABLED, storeModerator, verifyModeratorKey, type ModeratorSession } from "../services/moderator";
import { queueWelcome } from "../services/welcome";

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/** Moves the card's spotlight glow to the pointer (see .spotlight in index.css). */
function trackSpotlight(event: MouseEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty("--mx", `${event.clientX - rect.left}px`);
  event.currentTarget.style.setProperty("--my", `${event.clientY - rect.top}px`);
}

interface ChoiceProps {
  index: number;
  icon: ReactNode;
  iconClass: string;
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

/** One sign-in choice: a whole-card button with lift, glow and a staggered entrance. */
function Choice({ index, icon, iconClass, who, title, description, action, ariaLabel, active, busy, disabled, onClick }: ChoiceProps) {
  return (
    <motion.button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={active}
      disabled={disabled || busy}
      onClick={onClick}
      onMouseMove={trackSpotlight}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 + index * 0.07, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      whileHover={disabled ? undefined : { y: -5 }}
      whileTap={disabled ? undefined : { scale: 0.985 }}
      className={cn(
        "glass spotlight group flex h-full flex-col gap-4 rounded-3xl border p-5 text-left shadow-card transition-[border-color,box-shadow]",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55",
        active ? "border-accent shadow-[0_14px_40px_var(--primary-glow)] ring-2 ring-accent/40" : "hover:border-accent/40 hover:shadow-[0_14px_40px_var(--primary-glow)]",
      )}
    >
      <span className={cn("grid size-12 place-items-center rounded-2xl text-white shadow-card transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3", iconClass)}>
        {icon}
      </span>
      <span className="grid gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">{who}</span>
        <span className="font-display text-lg font-bold text-fg">{title}</span>
        <span className="text-[13px] leading-relaxed text-fg-muted">{description}</span>
      </span>
      <span className="mt-auto inline-flex items-center gap-1.5 text-sm font-semibold text-accent">
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {action}
        <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
      </span>
    </motion.button>
  );
}

export function SignInPage({
  target,
  onSignedIn,
  onViewOnly,
  onModerator,
  moderatorEnabled = MODERATOR_ENABLED,
  githubEnabled = OAUTH_ENABLED,
  verifyKey = verifyModeratorKey,
}: {
  target: GitHubTarget;
  onSignedIn: (session: GitHubSession) => void;
  /** Opens the read-only view for people without a GitHub account. */
  onViewOnly?: () => void;
  /** Signs in with the shared moderator pass key (Environment status updates only). */
  onModerator?: (session: ModeratorSession) => void;
  moderatorEnabled?: boolean;
  githubEnabled?: boolean;
  verifyKey?: (key: string) => Promise<void>;
}) {
  useTheme(); // apply saved theme
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [githubBusy, setGithubBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [moderatorOpen, setModeratorOpen] = useState(false);
  const [modName, setModName] = useState("");
  const [modKey, setModKey] = useState("");
  const [modBusy, setModBusy] = useState(false);
  const [modError, setModError] = useState<string | null>(null);
  const started = useRef(false);
  const modReady = modKey.trim().length > 0 && modName.trim().length >= 2;

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

  const submitModerator = async (event: FormEvent) => {
    event.preventDefault();
    if (!onModerator || !modReady) return;
    setModBusy(true);
    setModError(null);
    try {
      await verifyKey(modKey.trim());
      const session: ModeratorSession = { name: modName.trim(), key: modKey.trim(), remember };
      storeModerator(session);
      queueWelcome(session.name, "passkey");
      onModerator(session);
    } catch (e) {
      setModError((e as Error).message);
      setModBusy(false);
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

  const showModerator = Boolean(onModerator && moderatorEnabled);
  const choices = [
    {
      key: "github",
      show: true,
      icon: <GitHubMark className="size-6" />,
      iconClass: "bg-[linear-gradient(135deg,#24292f,#4b5563)]",
      who: "Team",
      title: "Sign in with GitHub",
      description: githubEnabled
        ? `Edit devices and the environment. Changes are committed under your name (Write access to ${target.repo} needed).`
        : "GitHub sign-in is not set up for this site.",
      action: "Continue with GitHub",
      ariaLabel: "Sign in with GitHub",
      busy: githubBusy,
      disabled: !githubEnabled,
      onClick: signInWithGitHub,
    },
    {
      key: "moderator",
      show: showModerator,
      icon: <KeyRound className="size-6" />,
      iconClass: "bg-primary-gradient",
      who: "Moderators · onsite",
      title: "Moderator pass key",
      description: "No GitHub account needed. Update the Environment status when you fix issues onsite.",
      action: moderatorOpen ? "Enter your details below" : "Use the pass key",
      ariaLabel: "Sign in as moderator",
      active: moderatorOpen,
      onClick: () => setModeratorOpen((open) => !open),
    },
    {
      key: "view",
      show: Boolean(onViewOnly),
      icon: <Eye className="size-6" />,
      iconClass: "bg-[linear-gradient(135deg,#0891b2,#22d3ee)]",
      who: "Everyone",
      title: "View only",
      description: "No account needed. Browse every robot, device and environment status — read only.",
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
          <p className="max-w-full truncate text-[13px] text-fg-muted" title={`${target.owner}/${target.repo} · ${target.branch} · ${target.filePath}`}>
            {target.owner}/{target.repo} · {target.branch} · {target.filePath}
          </p>
          <p className="text-sm text-fg-muted">How would you like to continue?</p>
        </motion.header>

        {error && (
          <Notice tone="danger" title="Sign-in failed" className="mb-5">
            {error}
          </Notice>
        )}

        <div className={cn("grid grid-cols-1 gap-4", choices.length === 3 ? "md:grid-cols-3" : choices.length === 2 ? "md:grid-cols-2" : "")}>
          {choices.map(({ key, show: _show, ...props }, i) => (
            <Choice key={key} index={i} {...props} />
          ))}
        </div>

        <AnimatePresence initial={false}>
          {moderatorOpen && showModerator && (
            <motion.div
              key="moderator-form"
              initial={{ opacity: 0, height: 0, y: -8 }}
              animate={{ opacity: 1, height: "auto", y: 0 }}
              exit={{ opacity: 0, height: 0, y: -8 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <form onSubmit={(e) => void submitModerator(e)} aria-label="Moderator sign-in" className="glass mt-4 grid gap-4 rounded-3xl border p-5 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="flex items-center gap-2 font-display text-base font-bold">
                      <UserCheck className="size-4 text-accent" aria-hidden /> Moderator sign-in
                    </h2>
                    <p className="mt-0.5 text-[13px] text-fg-muted">Your name is saved with every update you push, so the team can see who fixed what.</p>
                  </div>
                  <Button variant="ghost" size="icon" aria-label="Close moderator sign-in" onClick={() => setModeratorOpen(false)}>
                    <X className="size-4" />
                  </Button>
                </div>
                {modError && (
                  <Notice tone="danger" title="Could not sign in">
                    {modError}
                  </Notice>
                )}
                <div className="grid gap-3 sm:grid-cols-[1fr_1.3fr_auto] sm:items-end">
                  <div>
                    <FieldLabel htmlFor="moderator-name">Your name</FieldLabel>
                    <Input id="moderator-name" value={modName} maxLength={60} autoComplete="name" autoFocus onChange={(e) => setModName(e.target.value)} placeholder="e.g. Priya" />
                  </div>
                  <div>
                    <FieldLabel htmlFor="moderator-key">Pass key</FieldLabel>
                    <Input id="moderator-key" type="password" value={modKey} autoComplete="off" spellCheck={false} onChange={(e) => setModKey(e.target.value)} className="font-mono" />
                  </div>
                  <Button type="submit" variant="primary" className="h-10" loading={modBusy} disabled={!modReady} icon={<ArrowRight className="size-4" />}>
                    Continue
                  </Button>
                </div>
              </form>
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
