import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Cpu,
  FileJson,
  GitBranch,
  HardDrive,
  LayoutList,
  Loader2,
  LogOut,
  Moon,
  PencilLine,
  RefreshCw,
  Sun,
  UserRound,
  WifiOff,
} from "lucide-react";
import { NavLink, useLocation, useOutlet } from "react-router-dom";
import { Toaster } from "sonner";
import { useAuth } from "../../context/AuthContext";
import { useDeviceData, type SyncLabel } from "../../context/DeviceDataContext";
import { useBeforeUnload, useTheme } from "../../hooks";
import { cn, formatTime } from "../../lib/cn";
import { Button } from "../ui/primitives";

const statusStyles: Record<SyncLabel, { tone: string; icon: typeof CheckCircle2; spin?: boolean }> = {
  Connecting: { tone: "text-fg-muted bg-surface-2", icon: Loader2, spin: true },
  Syncing: { tone: "text-accent bg-accent-soft", icon: Loader2, spin: true },
  Connected: { tone: "text-success bg-success-soft", icon: CircleDot },
  "Saved to GitHub": { tone: "text-success bg-success-soft", icon: CheckCircle2 },
  "Saved locally": { tone: "text-success bg-success-soft", icon: CheckCircle2 },
  "Unsaved Changes": { tone: "text-warning bg-warning-soft", icon: PencilLine },
  "Conflict Detected": { tone: "text-danger bg-danger-soft", icon: AlertTriangle },
  "Connection Failed": { tone: "text-danger bg-danger-soft", icon: WifiOff },
  "File Missing": { tone: "text-warning bg-warning-soft", icon: AlertTriangle },
  "Invalid File": { tone: "text-danger bg-danger-soft", icon: AlertTriangle },
};

function SyncStatusPill() {
  const { syncLabel } = useDeviceData();
  const style = statusStyles[syncLabel];
  const Icon = style.icon;
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="sync-status"
      className={cn("inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium", style.tone)}
    >
      <Icon className={cn("size-3.5", style.spin && "animate-spin")} aria-hidden />
      {syncLabel}
    </span>
  );
}

const NAV = [
  { to: "/", label: "Device Manager", icon: Cpu, end: true },
  { to: "/devices", label: "All Devices", icon: LayoutList, end: false },
  { to: "/json", label: "JSON Preview", icon: FileJson, end: false },
];

export function AppShell() {
  const { config, snapshot, syncing, refresh, hasUnsavedChanges } = useDeviceData();
  const [theme, toggleTheme] = useTheme();
  const auth = useAuth();
  const location = useLocation();
  const outlet = useOutlet();
  useBeforeUnload(hasUnsavedChanges);

  const SourceIcon = config?.storage === "local" ? HardDrive : GitBranch;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-fg shadow-card">
              <Cpu className="size-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-semibold leading-tight text-fg">Device Information Manager</h1>
              {config ? (
                <a
                  href={config.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    "flex max-w-[60vw] items-center gap-1 truncate text-xs text-fg-muted sm:max-w-md",
                    config.repoUrl ? "hover:text-accent" : "pointer-events-none",
                  )}
                  title={config.location}
                >
                  <SourceIcon className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{config.location}</span>
                </a>
              ) : (
                <p className="text-xs text-fg-subtle">Connecting to data source…</p>
              )}
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <SyncStatusPill />
            <span className="hidden text-xs text-fg-muted md:inline" title={snapshot?.fetchedAt}>
              Last sync <span className="font-medium text-fg">{formatTime(snapshot?.fetchedAt)}</span>
            </span>
            {config?.user && (
              <span className="hidden items-center gap-1.5 text-xs text-fg-muted lg:inline-flex" title={auth?.session.name ?? config.user}>
                {auth?.session.avatarUrl ? (
                  <img src={auth.session.avatarUrl} alt="" className="size-5 rounded-full" />
                ) : (
                  <UserRound className="size-3.5" aria-hidden />
                )}
                {config.user}
              </span>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refresh()}
              disabled={syncing}
              icon={<RefreshCw className={cn("size-3.5", syncing && "animate-spin")} aria-hidden />}
              aria-label="Refresh from GitHub"
            >
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
            {auth && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Sign out"
                title="Sign out"
                onClick={() => {
                  if (!hasUnsavedChanges || window.confirm("You have unsaved changes. Sign out anyway?")) auth.signOut();
                }}
              >
                <LogOut className="size-4" />
              </Button>
            )}
          </div>
        </div>

        <nav aria-label="Main" className="mx-auto max-w-7xl overflow-x-auto px-4 sm:px-6">
          <ul className="flex gap-1">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    cn(
                      "relative flex items-center gap-2 whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive ? "text-fg" : "text-fg-muted hover:text-fg",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon className="size-4" aria-hidden />
                      {label}
                      {isActive && (
                        <motion.span layoutId="nav-underline" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />
                      )}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            {outlet}
          </motion.div>
        </AnimatePresence>
      </main>

      <Toaster position="bottom-right" theme={theme} richColors closeButton toastOptions={{ className: "text-sm" }} />
    </div>
  );
}
