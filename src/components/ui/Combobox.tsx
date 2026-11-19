import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { motion } from "framer-motion";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface ComboboxOption {
  value: string;
  label?: ReactNode;
  hint?: ReactNode;
}

export interface ComboboxProps {
  id?: string;
  label: string;
  value: string | null;
  options: ComboboxOption[];
  onChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  icon?: ReactNode;
  className?: string;
}

/** Accessible searchable dropdown (Radix Popover + cmdk). */
export function Combobox({
  id,
  label,
  value,
  options,
  onChange,
  placeholder,
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  disabled,
  icon,
  className,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild disabled={disabled}>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-haspopup="listbox"
          disabled={disabled}
          className={cn(
            "group flex h-11 w-full items-center gap-2.5 rounded-xl border border-border bg-surface px-3 text-left text-sm shadow-card transition",
            "hover:border-border-strong focus-visible:border-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring",
            "data-[state=open]:border-accent data-[state=open]:ring-4 data-[state=open]:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-55",
            className,
          )}
        >
          {icon && <span className="shrink-0 text-fg-subtle">{icon}</span>}
          <span className={cn("min-w-0 flex-1 truncate", selected ? "font-medium text-fg" : "text-fg-subtle")}>
            {selected ? (selected.label ?? selected.value) : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-fg-subtle" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-50 w-[var(--radix-popover-trigger-width)] min-w-[220px]" asChild>
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.12 }}>
            <Command
              label={label}
              className="overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
              filter={(itemValue, search) => (itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}
            >
              <div className="flex items-center gap-2 border-b border-border px-3">
                <Search className="size-4 text-fg-subtle" aria-hidden />
                <Command.Input
                  placeholder={searchPlaceholder}
                  className="h-10 w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
                />
              </div>
              <Command.List className="max-h-64 overflow-y-auto p-1.5">
                <Command.Empty className="px-3 py-6 text-center text-[13px] text-fg-muted">{emptyText}</Command.Empty>
                {options.map((option) => (
                  <Command.Item
                    key={option.value}
                    value={option.value}
                    onSelect={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-fg",
                      "data-[selected=true]:bg-accent-soft data-[selected=true]:text-accent",
                    )}
                  >
                    <Check className={cn("size-4 shrink-0", option.value === value ? "opacity-100" : "opacity-0")} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{option.label ?? option.value}</span>
                    {option.hint && <span className="shrink-0 text-xs text-fg-subtle">{option.hint}</span>}
                  </Command.Item>
                ))}
              </Command.List>
            </Command>
          </motion.div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
