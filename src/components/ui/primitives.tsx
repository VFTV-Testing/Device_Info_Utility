import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-ghost";
type ButtonSize = "sm" | "md" | "icon";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-primary-gradient text-white font-semibold shadow-[0_6px_20px_var(--primary-glow)] hover:brightness-110 hover:-translate-y-px active:translate-y-0",
  secondary: "glass text-fg border hover:bg-surface-2 hover:border-border-strong active:scale-[0.98]",
  ghost: "text-fg-muted hover:text-fg hover:bg-surface-2",
  danger: "bg-danger text-white hover:opacity-90 shadow-card",
  "danger-ghost": "text-danger hover:bg-danger-soft",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  icon: "h-9 w-9 justify-center",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center rounded-xl font-medium whitespace-nowrap transition-[color,background-color,border-color,transform,filter] duration-150",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...props }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-fg transition",
          "placeholder:text-fg-subtle hover:border-border-strong",
          "focus:border-accent focus:outline-none focus:ring-4 focus:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-60",
          invalid && "border-danger focus:border-danger focus:ring-danger/20",
          className,
        )}
        {...props}
      />
    );
  },
);

export function NativeSelect({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn("relative", className)}>
      <select
        className={cn(
          "h-9 w-full appearance-none rounded-xl border border-border bg-surface pl-3 pr-8 text-sm text-fg",
          "hover:border-border-strong focus:border-accent focus:outline-none focus:ring-4 focus:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-60",
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
    </div>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("glass rounded-3xl border shadow-card", className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  actions,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div className="flex min-w-0 items-start gap-3">
        {icon && <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">{icon}</div>}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-fg-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";
const badgeTones: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-fg-muted border-border",
  accent: "bg-accent-soft text-accent border-transparent",
  success: "bg-success-soft text-success border-transparent",
  warning: "bg-warning-soft text-warning border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
};

export function Badge({ tone = "neutral", className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", badgeTones[tone], className)}
      {...props}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-lg bg-surface-2", className)} />;
}

export function FieldLabel({ htmlFor, children, hint }: { htmlFor?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px] font-medium text-fg">
      <span>{children}</span>
      {hint && <span className="text-[11px] font-normal text-fg-subtle">{hint}</span>}
    </label>
  );
}

export function FieldError({ id, children }: { id?: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-danger">
      {children}
    </p>
  );
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">{icon}</div>
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {description && <p className="mt-1 max-w-md text-[13px] text-fg-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Notice({
  tone = "neutral",
  icon,
  title,
  children,
  actions,
  className,
}: {
  tone?: BadgeTone;
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const tones: Record<BadgeTone, string> = {
    neutral: "border-border bg-surface-2",
    accent: "border-accent/30 bg-accent-soft",
    success: "border-success/30 bg-success-soft",
    warning: "border-warning/30 bg-warning-soft",
    danger: "border-danger/30 bg-danger-soft",
  };
  const iconTones: Record<BadgeTone, string> = {
    neutral: "text-fg-muted",
    accent: "text-accent",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
  };
  return (
    <div role="status" className={cn("flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-start", tones[tone], className)}>
      <div className="flex min-w-0 flex-1 gap-3">
        {icon && <div className={cn("mt-0.5 shrink-0", iconTones[tone])}>{icon}</div>}
        <div className="min-w-0 text-sm">
          <p className="font-medium text-fg">{title}</p>
          {children && <div className="mt-1 text-[13px] text-fg-muted">{children}</div>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
