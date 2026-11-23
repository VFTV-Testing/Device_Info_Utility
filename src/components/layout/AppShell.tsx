import { AnimatePresence, motion } from "framer-motion";
import { Activity, Cpu, Eye, GitBranch, HardDrive, LayoutGrid, LogIn, LogOut, UserRound } from "lucide-react";
import { Suspense, useEffect, useRef, useState, type RefObject } from "react";
import { NavLink, useLocation, useOutlet } from "react-router-dom";
import { Toaster } from "sonner";
import { takeWelcome } from "../../services/welcome";
import { showWelcome } from "./WelcomeToast";
import { useAuth } from "../../context/AuthContext";
import { clearFamilySwitch, familySwitchPending } from "../../context/FamilyContext";
import { useModerator } from "../../context/ModeratorContext";
import { useViewMode } from "../../context/ViewModeContext";
import { useDeviceData } from "../../context/DeviceDataContext";
import { useBackground, useBeforeUnload, useTheme } from "../../hooks";
import { cn } from "../../lib/cn";
import { PageSkeleton } from "../common/DataStateGate";
import { Button } from "../ui/primitives";
import { AnimatedBackground, isCanvasScene } from "./AnimatedBackground";
import { AppearanceMenu } from "./AppearanceMenu";
import { FamilySwitcher } from "./FamilySwitcher";
import { SyncControl } from "./SyncControl";

/** True once the page is scrolled, so the header can get a backdrop only when content passes under it. */
function useScrolled(threshold = 8): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return scrolled;
}

/**
 * Marks <html data-scrolling> while the page is being scrolled (and briefly after). The animated
 * backgrounds hold still meanwhile, so the frosted panels are not re-blurred on every frame.
 */
function useScrollingFlag(idleMs = 160) {
  useEffect(() => {
    const root = document.documentElement;
    let timer = 0;
    const onScroll = () => {
      if (!timer) root.setAttribute("data-scrolling", "");
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = 0;
        root.removeAttribute("data-scrolling");
      }, idleMs);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(timer);
      root.removeAttribute("data-scrolling");
    };
  }, [idleMs]);
}

/** Where the welcome message goes: just below the header, however tall it is (it wraps on narrow screens). */
function useHeaderBottom(header: RefObject<HTMLElement | null>, gap = 10): number {
  const [bottom, setBottom] = useState(84);
  useEffect(() => {
    const el = header.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setBottom(Math.round(el.getBoundingClientRect().height) + gap);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [header, gap]);
  return bottom;
}

const NAV = [
  { to: "/", label: "Device Manager", icon: Cpu, end: true },
  { to: "/devices", label: "All Devices", icon: LayoutGrid, end: false },
  { to: "/environment", label: "Environment", icon: Activity, end: false },
];

export function AppShell() {
  const { config, hasUnsavedChanges } = useDeviceData();
  const [theme, setTheme] = useTheme();
  const [background, setBackground] = useBackground();
  const auth = useAuth();
  const viewMode = useViewMode();
  const moderator = useModerator();
  // View-only visitors cannot edit, so the editor page is not offered to them.
  const nav = viewMode || moderator ? NAV.filter((item) => item.to !== "/") : NAV;
  const location = useLocation();
  const outlet = useOutlet();
  const scrolled = useScrolled();
  const headerRef = useRef<HTMLElement>(null);
  const welcomeTop = useHeaderBottom(headerRef);
  useScrollingFlag();
  const [fadeIn] = useState(familySwitchPending);
  useEffect(() => clearFamilySwitch(), []);
  useBeforeUnload(hasUnsavedChanges);

  const SourceIcon = config?.storage === "local" ? HardDrive : GitBranch;
  const initials = (auth?.session.name ?? config?.user ?? "").slice(0, 2).toUpperCase();

  // Greet once after a fresh sign-in. The short delay lets the top-right Toaster mount first
  // (and the cleanup keeps React StrictMode's double effect from greeting twice).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const welcome = takeWelcome();
      if (welcome) showWelcome(welcome);
    }, 50);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-dvh">
      {isCanvasScene(background) && <AnimatedBackground scene={background} theme={theme} />}
      <header
        ref={headerRef}
        className={cn(
          "sticky top-0 z-30 px-3 pb-3 pt-3 transition-[background] duration-300 sm:px-6",
          scrolled && "bg-[linear-gradient(to_bottom,var(--bg)_92%,transparent)]",
        )}
      >
        <div className="glass-strong mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border px-3 py-2 shadow-card">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-[linear-gradient(135deg,#6366f1,#22d3ee)] text-white shadow-card">
              <Cpu className="size-[18px]" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-display text-[14px] font-bold leading-tight text-fg">Device Manager</h1>
              {config?.viewOnly ? (
                // View-only visitors and moderators don't need to see where the data lives.
                <p className="text-[11px] text-fg-muted">Device information</p>
              ) : config ? (
                <a
                  href={config.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    "flex max-w-[52vw] items-center gap-1 truncate text-[11px] text-fg-muted sm:max-w-[200px]",
                    config.repoUrl ? "hover:text-accent" : "pointer-events-none",
                  )}
                  title={config.location}
                >
                  <SourceIcon className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{config.location}</span>
                </a>
              ) : (
                <p className="text-[11px] text-fg-subtle">Connecting to data source…</p>
              )}
            </div>
            <FamilySwitcher confirmLeave={() => !hasUnsavedChanges || window.confirm("You have unsaved changes in this family. Switch anyway?")} />
          </div>

          <nav aria-label="Main" className="order-last w-full overflow-x-auto lg:order-none lg:ml-4 lg:w-auto">
            <ul className="flex w-max gap-1 rounded-full bg-surface-2/70 p-1">
              {nav.map(({ to, label, icon: Icon, end }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      cn(
                        "relative flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                        isActive ? "text-fg" : "text-fg-muted hover:text-fg",
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <motion.span
                            layoutId="nav-pill"
                            className="absolute inset-0 rounded-full bg-accent-soft ring-1 ring-accent/35"
                            transition={{ type: "spring", stiffness: 500, damping: 38 }}
                          />
                        )}
                        <Icon className="relative size-4" aria-hidden />
                        <span className="relative">{label}</span>
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            {viewMode && (
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-accent-soft px-2.5 text-xs font-semibold text-accent">
                <Eye className="size-3.5" aria-hidden /> View only
              </span>
            )}
            <SyncControl />
            {config?.user && (
              <span
                className="ml-1 hidden size-7 place-items-center overflow-hidden rounded-full bg-surface-2 text-[11px] font-semibold text-fg-muted sm:grid"
                title={auth?.session.name ?? config.user}
              >
                {auth?.session.avatarUrl ? (
                  <img src={auth.session.avatarUrl} alt={config.user} className="size-7" />
                ) : initials ? (
                  initials
                ) : (
                  <UserRound className="size-4" aria-hidden />
                )}
              </span>
            )}
            <AppearanceMenu theme={theme} onTheme={setTheme} background={background} onBackground={setBackground} />
            {viewMode && (
              <Button variant="secondary" size="sm" className="h-7 text-xs" onClick={viewMode.exit} icon={<LogIn className="size-3.5" aria-hidden />}>
                Sign in to edit
              </Button>
            )}
            {moderator && (
              <>
                <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-accent-soft px-2.5 text-xs font-semibold text-accent" title="Signed in with the moderator key">
                  <UserRound className="size-3.5" aria-hidden /> Moderator · {moderator.name}
                </span>
                <Button variant="secondary" size="sm" className="h-7 text-xs" onClick={moderator.signOut} icon={<LogOut className="size-3.5" aria-hidden />}>
                  Sign out
                </Button>
              </>
            )}
            {auth && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
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
      </header>

      {/* The shell mounts again for each device family: after a switch the new one fades in from a blur. */}
      <motion.main
        initial={fadeIn ? { opacity: 0, filter: "blur(6px)" } : false}
        animate={{ opacity: 1, filter: "blur(0px)" }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            <Suspense fallback={<PageSkeleton />}>{outlet}</Suspense>
          </motion.div>
        </AnimatePresence>
      </motion.main>

      <Toaster position="bottom-right" theme={theme} richColors closeButton toastOptions={{ className: "text-sm" }} />
      <Toaster id="welcome" className="welcome-toaster" position="top-right" offset={{ top: welcomeTop }} theme={theme} />
    </div>
  );
}
