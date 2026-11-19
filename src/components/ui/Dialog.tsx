import * as RadixDialog from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Button } from "./primitives";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Prevent closing by outside click / Escape (e.g. while saving). */
  locked?: boolean;
}

const sizes = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };

export function Dialog({ open, onOpenChange, title, description, children, footer, size = "md", locked }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => (!locked || next ? onOpenChange(next) : undefined)}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay asChild>
          <motion.div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
          />
        </RadixDialog.Overlay>
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
          <RadixDialog.Content
            asChild
            onPointerDownOutside={(e) => locked && e.preventDefault()}
            onEscapeKeyDown={(e) => locked && e.preventDefault()}
          >
            <motion.div
              className={cn("relative flex max-h-[calc(100dvh-2rem)] w-full flex-col rounded-2xl border border-border bg-surface shadow-2xl", sizes[size])}
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
                <div className="min-w-0">
                  <RadixDialog.Title className="text-base font-semibold text-fg">{title}</RadixDialog.Title>
                  {description ? (
                    <RadixDialog.Description className="mt-1 text-[13px] text-fg-muted">{description}</RadixDialog.Description>
                  ) : (
                    <RadixDialog.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</RadixDialog.Description>
                  )}
                </div>
                <RadixDialog.Close asChild>
                  <Button variant="ghost" size="icon" aria-label="Close" disabled={locked} className="-mr-2 -mt-1 size-8">
                    <X className="size-4" />
                  </Button>
                </RadixDialog.Close>
              </div>
              {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>}
              {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
            </motion.div>
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  loading?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "primary",
  loading,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      locked={loading}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
