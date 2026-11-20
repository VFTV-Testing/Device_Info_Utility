import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { motion } from "framer-motion";
import { Check, ChevronsUpDown, Plus, Search, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface MultiSelectOption {
  value: string;
  label?: ReactNode;
  hint?: ReactNode;
  /** Options with a group are listed under that heading (e.g. ports per device). */
  group?: string;
  /** Text used in the closed trigger, e.g. "X101-GER PORT1". Defaults to the value. */
  summary?: string;
}

export interface MultiSelectProps {
  id?: string;
  label: string;
  values: string[];
  options: MultiSelectOption[];
  onChange: (values: string[]) => void;
  placeholder: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  icon?: ReactNode;
  /** "field": full-width form control. "chip": compact filter pill (Aurora filter bar). */
  variant?: "field" | "chip";
  className?: string;
}

function summary(values: string[], max = 2): string {
  if (values.length <= max) return values.join(", ");
  return `${values.slice(0, max).join(", ")} +${values.length - max}`;
}

/**
 * Searchable dropdown that allows several selections (Radix Popover + cmdk).
 * Clicking an option toggles it and keeps the list open; "Select all" / "Clear" act on all options.
 */
export function MultiSelect({
  id,
  label,
  values,
  options,
  onChange,
  placeholder,
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  disabled,
  icon,
  variant = "field",
  className,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const selected = new Set(values);
  const ordered = options.filter((o) => selected.has(o.value)).map((o) => o.value);
  const orderedText = options.filter((o) => selected.has(o.value)).map((o) => o.summary ?? o.value);
  const allSelected = options.length > 0 && ordered.length === options.length;

  // Consecutive options that share a group are rendered under one heading.
  const sections: { group?: string; items: MultiSelectOption[] }[] = [];
  for (const option of options) {
    const last = sections[sections.length - 1];
    if (last && last.group === option.group) last.items.push(option);
    else sections.push({ group: option.group, items: [option] });
  }
  const setGroup = (items: MultiSelectOption[], on: boolean) => {
    const groupValues = new Set(items.map((i) => i.value));
    onChange(options.map((o) => o.value).filter((v) => (groupValues.has(v) ? on : selected.has(v))));
  };

  const toggle = (value: string) => {
    const next = selected.has(value) ? ordered.filter((v) => v !== value) : options.map((o) => o.value).filter((v) => selected.has(v) || v === value);
    onChange(next);
  };

  const isChip = variant === "chip";
  const active = ordered.length > 0;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div className={cn("relative", isChip ? "inline-flex" : "w-full", className)}>
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
              "group flex items-center text-left text-sm transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-55",
              isChip
                ? cn(
                    "h-9 gap-1.5 rounded-full px-3.5",
                    active
                      ? "border border-accent/40 bg-accent-soft pr-8 font-medium text-accent"
                      : "border border-dashed border-border-strong text-fg-muted hover:border-accent/50 hover:text-fg",
                  )
                : cn(
                    "h-11 w-full gap-2.5 rounded-xl border border-border bg-surface px-3",
                    "hover:border-border-strong focus-visible:border-accent",
                    "data-[state=open]:border-accent data-[state=open]:ring-4 data-[state=open]:ring-ring",
                  ),
            )}
          >
            {isChip ? (
              <>
                {!active && <Plus className="size-3.5" aria-hidden />}
                <span className="whitespace-nowrap">{active ? `${placeholder}: ${summary(orderedText, 1)}` : placeholder}</span>
              </>
            ) : (
              <>
                {icon && <span className="shrink-0 text-fg-subtle">{icon}</span>}
                <span className={cn("min-w-0 flex-1 truncate", active ? "font-medium text-fg" : "text-fg-subtle")}>
                  {active ? summary(orderedText) : placeholder}
                </span>
                {ordered.length > 1 && (
                  <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">{ordered.length}</span>
                )}
                <ChevronsUpDown className="size-4 shrink-0 text-fg-subtle" aria-hidden />
              </>
            )}
          </button>
        </Popover.Trigger>
        {isChip && active && (
          <button
            type="button"
            aria-label={`Clear ${label} filter`}
            onClick={() => onChange([])}
            className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-accent hover:bg-accent/15"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className={cn("z-50", isChip ? "w-64" : "w-[var(--radix-popover-trigger-width)] min-w-[240px]")}
          asChild
        >
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.12 }}>
            <Command
              label={label}
              className="overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
              filter={(itemValue, search) => (itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}
            >
              <div className="flex items-center gap-2 border-b border-border px-3">
                <Search className="size-4 text-fg-subtle" aria-hidden />
                <Command.Input
                  placeholder={searchPlaceholder}
                  className="h-10 w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
                />
              </div>
              <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs">
                <span className="text-fg-muted">
                  {ordered.length} of {options.length} selected
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={allSelected}
                    onClick={() => onChange(options.map((o) => o.value))}
                    className="rounded-md px-2 py-1 font-medium text-accent hover:bg-accent-soft disabled:opacity-40"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    disabled={!active}
                    onClick={() => onChange([])}
                    className="rounded-md px-2 py-1 font-medium text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <Command.List className="max-h-64 overflow-y-auto p-1.5" aria-multiselectable="true">
                <Command.Empty className="px-3 py-6 text-center text-[13px] text-fg-muted">{emptyText}</Command.Empty>
                {sections.map(({ group, items }) => {
                  const renderItem = (option: MultiSelectOption) => {
                    const checked = selected.has(option.value);
                    return (
                      <Command.Item
                        key={option.value}
                        value={option.value}
                        aria-label={group ? `${option.summary ?? `${group} ${option.value}`}${checked ? " (selected)" : ""}` : undefined}
                        onSelect={() => toggle(option.value)}
                        className={cn(
                          "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-fg",
                          "data-[selected=true]:bg-surface-2",
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "grid size-4 shrink-0 place-items-center rounded-[5px] border transition",
                            checked ? "border-transparent bg-primary-gradient text-white" : "border-border-strong",
                          )}
                        >
                          {checked && <Check className="size-3" strokeWidth={3} />}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{option.label ?? option.value}</span>
                        {option.hint && <span className="shrink-0 text-xs text-fg-subtle">{option.hint}</span>}
                        <span className="sr-only">{checked ? "(selected)" : ""}</span>
                      </Command.Item>
                    );
                  };
                  if (!group) return items.map(renderItem);
                  const allOn = items.every((i) => selected.has(i.value));
                  return (
                    <Command.Group
                      key={group}
                      heading={
                        <span className="flex items-center justify-between gap-2">
                          <span>{group}</span>
                          <button
                            type="button"
                            onClick={() => setGroup(items, !allOn)}
                            className="rounded-md px-1.5 py-0.5 text-[11px] font-medium normal-case tracking-normal text-accent hover:bg-accent-soft"
                          >
                            {allOn ? "None" : "All"}
                          </button>
                        </span>
                      }
                      className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-fg-subtle"
                    >
                      {items.map(renderItem)}
                    </Command.Group>
                  );
                })}
              </Command.List>
            </Command>
          </motion.div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
