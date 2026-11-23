import * as Popover from "@radix-ui/react-popover";
import { motion } from "framer-motion";
import { Check, Moon, Palette, Sun } from "lucide-react";
import { BACKGROUNDS, type Background, type Theme } from "../../hooks";
import { cn } from "../../lib/cn";
import { Button } from "../ui/primitives";
import { isCanvasScene, ScenePreview } from "./AnimatedBackground";

interface AppearanceMenuProps {
  /** The theme in effect (follows the Windows / browser setting unless overridden). */
  theme: Theme;
  onTheme: (next: Theme) => void;
  background: Background;
  onBackground: (next: Background) => void;
}

/** Theme (follows the system; Light / Dark override it) and page background, saved per browser. */
export function AppearanceMenu({ theme, onTheme, background, onBackground: setBackground }: AppearanceMenuProps) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label="Appearance" title="Appearance">
          <Palette className="size-4" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="z-50 w-80" asChild>
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.12 }}
            className="rounded-2xl border border-border bg-surface p-4 shadow-2xl"
          >
            <p className="text-xs font-medium text-fg-muted">Theme</p>
            <div className="mt-1.5 flex rounded-xl bg-surface-2 p-1" role="radiogroup" aria-label="Theme">
              {(
                [
                  ["light", "Light", Sun],
                  ["dark", "Dark", Moon],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={theme === id}
                  onClick={() => onTheme(id)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition",
                    theme === id ? "bg-primary-gradient text-white shadow-card" : "text-fg-muted hover:text-fg",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                  {label}
                </button>
              ))}
            </div>

            <p className="mt-4 text-xs font-medium text-fg-muted">Background</p>
            <div className="mt-1.5 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Background">
              {BACKGROUNDS.map(({ id, label, hint }) => {
                const active = background === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    title={hint}
                    onClick={() => setBackground(id)}
                    className="group text-left focus-visible:outline-none"
                  >
                    <span
                      data-preview={id}
                      className={cn(
                        "bg-preview block h-14 rounded-xl border transition group-hover:scale-[1.03] group-focus-visible:ring-4 group-focus-visible:ring-ring",
                        active ? "border-accent ring-2 ring-accent/40" : "border-border",
                      )}
                    >
                      {isCanvasScene(id) && <ScenePreview scene={id} theme={theme} className="absolute inset-0 size-full" />}
                      {active && (
                        <span className="absolute right-1.5 top-1.5 z-10 grid size-4 place-items-center rounded-full bg-primary-gradient text-white">
                          <Check className="size-2.5" strokeWidth={3} aria-hidden />
                        </span>
                      )}
                    </span>
                    <span className={cn("mt-1 block text-[11px]", active ? "font-semibold text-fg" : "text-fg-muted")}>{label}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-[11px] text-fg-subtle">Theme follows your Windows or browser setting. Saved in this browser only.</p>
          </motion.div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
