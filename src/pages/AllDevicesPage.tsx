import { animate, AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Database,
  FileJson,
  FileUp,
  LayoutGrid,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  Rows3,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { naturalCompare } from "../../shared/deviceId";
import type { DeviceRecord } from "../../shared/types";
import { pickRecord } from "../../shared/validation";
import { DataStateGate } from "../components/common/DataStateGate";
import { BulkEditForm } from "../components/device/BulkEditForm";
import { commitToast } from "../components/device/RecordForm";
import { AddDeviceDialog } from "../components/dialogs/AddDeviceDialog";
import { ImportDialog } from "../components/dialogs/ImportDialog";
import { ConfirmDialog, Dialog } from "../components/ui/Dialog";
import { MultiSelect } from "../components/ui/MultiSelect";
import { Button, Card, EmptyState, Input, NativeSelect } from "../components/ui/primitives";
import { useDeviceData } from "../context/DeviceDataContext";
import { useDebouncedValue } from "../hooks";
import { cn } from "../lib/cn";
import { chipStyle, hardwareTones, toneOf } from "../lib/hardware";
import {
  buildRows,
  COUNTRY_NAMES,
  describeFilters,
  EMPTY_FILTERS,
  FILTER_LABELS,
  FILTER_NAMES,
  hasActiveFilters,
  loadFilterState,
  rowMatcher,
  saveFilterState,
  type FilterName,
  type Filters,
  type Row,
} from "../lib/deviceFilters";
import { ApiError } from "../services/api";

type SortColumn = "device" | "port" | "key" | keyof DeviceRecord;
type View = "cards" | "table";

const COLUMNS: { id: SortColumn; label: string; className?: string }[] = [
  { id: "device", label: "Robot" },
  { id: "port", label: "Device port" },
  { id: "key", label: "Full Device Identifier", className: "min-w-[280px]" },
  { id: "sprintNo", label: "sprintNo" },
  { id: "Cver", label: "Cver" },
  { id: "firmwareVersion", label: "firmwareVersion" },
  { id: "appVersion", label: "appVersion" },
  { id: "Hardware", label: "Platform" },
  { id: "Country", label: "Country" },
];
const PAGE_SIZES = [10, 25, 50, 100];
/** A port tile's content: a button that opens the editor, or plain content for view-only visitors. */
function TileBody({
  editable,
  onClick,
  disabled,
  label,
  children,
}: {
  editable: boolean;
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: ReactNode;
}) {
  if (!editable) return <div className="block w-full">{children}</div>;
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className="block w-full text-left focus-visible:outline-none">
      {children}
    </button>
  );
}

/** Moves the card's spotlight glow to the pointer (see .spotlight in index.css). */
function trackSpotlight(event: MouseEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty("--mx", `${event.clientX - rect.left}px`);
  event.currentTarget.style.setProperty("--my", `${event.clientY - rect.top}px`);
}

/** Counts up to `target` once, for the hero number. Instant when reduced motion is requested. */
function useCountUp(target: number): number {
  const [value, setValue] = useState(target);
  const from = useRef(0);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setValue(target);
      from.current = target;
      return;
    }
    const controls = animate(from.current, target, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setValue(Math.round(v)),
    });
    from.current = target;
    return () => controls.stop();
  }, [target]);
  return value;
}
const VIEW_KEY = "dim-devices-view";

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort(naturalCompare);
}

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "table" ? "table" : "cards";
  } catch {
    return "cards";
  }
}

export function AllDevicesPage() {
  const { snapshot, refresh, syncing, deleteRecord, writing, config } = useDeviceData();
  /** View-only visitors and accounts without write access see no editing controls. */
  const canEdit = !config?.readOnly;
  const navigate = useNavigate();
  // Filters are remembered for this tab, so they survive a trip to the JSON page and back.
  const [query, setQuery] = useState(() => loadFilterState().query);
  const [filters, setFilters] = useState<Filters>(() => loadFilterState().filters);
  useEffect(() => saveFilterState({ filters, query }), [filters, query]);
  const [sort, setSort] = useState<{ column: SortColumn; dir: "asc" | "desc" }>({ column: "key", dir: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setViewState] = useState<View>(readView);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Row | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const search = useDebouncedValue(query.trim().toLowerCase(), 200);

  const setView = (next: View) => {
    setViewState(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* per-browser convenience only */
    }
  };

  const rows = useMemo<Row[]>(() => buildRows(snapshot?.data ?? {}), [snapshot]);

  const options = useMemo(
    () => Object.fromEntries(FILTER_NAMES.map((n) => [n, uniqueSorted(rows.map((r) => r[n]))])) as Record<FilterName, string[]>,
    [rows],
  );
  const tones = useMemo(() => hardwareTones(options.Hardware), [options.Hardware]);
  const counts = useMemo(() => {
    const result = {} as Record<FilterName, Map<string, number>>;
    for (const name of FILTER_NAMES) {
      const map = new Map<string, number>();
      for (const row of rows) map.set(row[name], (map.get(row[name]) ?? 0) + 1);
      result[name] = map;
    }
    return result;
  }, [rows]);
  const filtered = useMemo(() => {
    const result = rows.filter(rowMatcher(filters, search));
    const dir = sort.dir === "asc" ? 1 : -1;
    return result.sort((a, b) => dir * naturalCompare(a[sort.column], b[sort.column]) || naturalCompare(a.key, b.key));
  }, [rows, filters, search, sort]);
  const isFiltered = hasActiveFilters(filters, search);

  /** The summary panels describe whatever the filters currently match. */
  const summary = useMemo(() => {
    const unique = (pick: (r: Row) => string) => [...new Set(filtered.map(pick))].filter((v) => v !== "—").sort(naturalCompare);
    return {
      robots: unique((r) => r.device),
      platforms: unique((r) => r.Hardware),
      countries: unique((r) => r.country),
      services: unique((r) => r.service),
      sprints: unique((r) => r.sprintNo),
    };
  }, [filtered]);
  const shownCount = useCountUp(filtered.length);

  // Every platform stays listed (0 = greyed) so it can still be clicked to filter.
  const hardwareMix = useMemo(
    () =>
      options.Hardware.map((hw) => ({ hw, count: filtered.filter((r) => r.Hardware === hw).length })).sort(
        (a, b) => b.count - a.count || naturalCompare(a.hw, b.hw),
      ),
    [options.Hardware, filtered],
  );

  const openJson = () => navigate("/json", { state: { fromDevices: true } });

  const groups = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of filtered) {
      const list = map.get(row.device) ?? [];
      list.push(row);
      map.set(row.device, list);
    }
    return [...map.entries()]
      .sort(([a], [b]) => naturalCompare(a, b))
      .map(([device, list]) => ({ device, rows: list.sort((a, b) => naturalCompare(a.port, b.port) || naturalCompare(a.key, b.key)) }));
  }, [filtered]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const activeFilters = Object.values(filters).reduce((n, v) => n + (v.length ? 1 : 0), 0) + (query ? 1 : 0);
  const selectedKeys = [...selected].filter((k) => rows.some((r) => r.key === k));
  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.key));

  const setFilter = (name: FilterName, values: string[]) => {
    setFilters((f) => ({ ...f, [name]: values }));
    setPage(1);
  };
  const toggleHardware = (hw: string) =>
    setFilter("Hardware", filters.Hardware.includes(hw) ? filters.Hardware.filter((h) => h !== hw) : [...filters.Hardware, hw]);
  const clearFilters = () => {
    setQuery("");
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  const toggleSelected = (keys: string[], on?: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      const turnOn = on ?? !keys.every((k) => next.has(k));
      for (const k of keys) {
        if (turnOn) next.add(k);
        else next.delete(k);
      }
      return next;
    });

  const toggleSort = (column: SortColumn) =>
    setSort((s) => (s.column === column ? { column, dir: s.dir === "asc" ? "desc" : "asc" } : { column, dir: "asc" }));

  const edit = (row: Row) => navigate(`/?key=${encodeURIComponent(row.key)}`);

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      const result = await deleteRecord(toDelete.key, pickRecord(toDelete));
      commitToast(config?.storage === "local" ? "Record deleted" : "Record deleted in GitHub", result.commit, config?.storage === "local");
      toggleSelected([toDelete.key], false);
    } catch (e) {
      const error = e as ApiError;
      toast.error("Delete failed — nothing was changed", { description: error.message });
      if (error.code === "RECORD_CONFLICT") void refresh();
    } finally {
      setToDelete(null);
    }
  };

  return (
    <DataStateGate>
      <div className="space-y-5">
        <h2 className="sr-only">All Devices</h2>

        {/* Bento: summary + platform mix */}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            onMouseMove={trackSpotlight}
            className="spotlight relative flex flex-wrap items-end gap-4 overflow-hidden rounded-3xl border border-[var(--hero-border)] bg-hero-gradient p-6 shadow-card"
          >
            <Sparkles className="pointer-events-none absolute -right-6 -top-6 size-40 text-accent opacity-[0.07]" aria-hidden />
            <div className="min-w-0 flex-1 basis-[24rem]">
              {isFiltered ? (
                <p className="truncate text-[13px] text-fg-muted" title={describeFilters(filters, search)}>
                  <span className="mr-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">Filtered</span>
                  {describeFilters(filters, search)}
                </p>
              ) : (
                <p className="truncate text-[13px] text-fg-muted" title={config?.location}>
                  {config?.location ?? "deviceInformation.json"}
                </p>
              )}
              <p
                className="mt-2 bg-[linear-gradient(135deg,var(--fg),var(--accent))] bg-clip-text font-display text-7xl font-bold leading-none tracking-tight text-transparent tabular-nums"
                data-testid="record-count"
                aria-label={isFiltered ? `${filtered.length} of ${rows.length} records` : `${rows.length} records`}
              >
                {shownCount}
              </p>
              <p className="mt-2 text-sm text-fg-muted">
                {isFiltered ? (
                  <>
                    of <strong className="text-fg">{rows.length}</strong> records · across{" "}
                    <strong className="text-fg">{summary.robots.length}</strong> robot{summary.robots.length === 1 ? "" : "s"}
                  </>
                ) : (
                  <>
                    records across <strong className="text-fg">{summary.robots.length}</strong> robots
                  </>
                )}
              </p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {(
                  [
                    [summary.platforms.length, "platform", "platforms", summary.platforms.join(", ")],
                    [summary.countries.length, "country", "countries", summary.countries.map((c) => COUNTRY_NAMES[c] ?? c).join(", ")],
                    [summary.services.length, "stream type", "stream types", summary.services.join(", ")],
                    [summary.sprints.length, "sprint build", "sprint builds", summary.sprints.join(", ")],
                  ] as const
                ).map(([n, one, many, detail]) => (
                  <span
                    key={many}
                    title={detail || undefined}
                    className="rounded-full bg-surface/60 px-2.5 py-1 text-[11px] text-fg-muted backdrop-blur"
                  >
                    <strong className="font-semibold text-fg">{n}</strong> {n === 1 ? one : many}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canEdit && (
                <Button variant="primary" onClick={() => setAddOpen(true)} icon={<Plus className="size-4" />}>
                  Add device
                </Button>
              )}
              <div className="flex flex-wrap gap-2">
                {canEdit && (
                  <Button onClick={() => setImportOpen(true)} icon={<FileUp className="size-4" />}>
                    Import JSON
                  </Button>
                )}
                <Button
                  onClick={openJson}
                  icon={<FileJson className="size-4" />}
                  title={isFiltered ? "Show the JSON of the records these filters match" : "Show the whole file as JSON"}
                >
                  {isFiltered ? `View JSON (${filtered.length})` : "View JSON"}
                </Button>
                <Button size="icon" onClick={() => void refresh()} loading={syncing} aria-label="Refresh" title="Refresh from GitHub">
                  {!syncing && <RefreshCw className="size-4" />}
                </Button>
              </div>
            </div>
          </motion.div>

          <Card className="spotlight p-6" onMouseMove={trackSpotlight}>
            <div className="flex items-baseline justify-between">
              <p className="font-display text-base font-semibold text-fg">Platform mix</p>
              <p className="text-xs text-fg-muted">{isFiltered ? `For ${filtered.length} filtered records · click to filter` : "Click to filter"}</p>
            </div>
            <div className="mt-4 flex h-3.5 gap-[3px] overflow-hidden rounded-full" role="group" aria-label="Platform mix">
              {hardwareMix
                .filter(({ count }) => count > 0)
                .map(({ hw, count }) => {
                  const on = filters.Hardware.length === 0 || filters.Hardware.includes(hw);
                  return (
                    <motion.button
                      key={hw}
                      type="button"
                      aria-label={`Filter by ${hw} (${count})`}
                      title={`${hw}: ${count}`}
                      onClick={() => toggleHardware(hw)}
                      initial={{ width: 0 }}
                      animate={{ width: `${(count / Math.max(filtered.length, 1)) * 100}%` }}
                      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                      className={cn("h-full min-w-1.5 transition-opacity hover:opacity-80", !on && "opacity-25")}
                      style={{ backgroundColor: toneOf(tones, hw).solid }}
                    />
                  );
                })}
            </div>
            <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1">
              {hardwareMix.map(({ hw, count }) => {
                const active = filters.Hardware.includes(hw);
                return (
                  <li key={hw}>
                    <button
                      type="button"
                      onClick={() => toggleHardware(hw)}
                      aria-pressed={active}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] transition hover:bg-surface-2",
                        active ? "font-semibold text-fg" : "text-fg-muted",
                        count === 0 && "opacity-45",
                      )}
                    >
                      <span className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: toneOf(tones, hw).solid }} />
                      <span className="truncate">{hw}</span>
                      <span className="ml-auto font-semibold text-fg">{count}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>

        {/* Aurora filter bar — stays in reach while scrolling on large screens */}
        <Card className="z-20 flex flex-col gap-2.5 rounded-2xl p-3 lg:sticky lg:top-[90px] lg:glass-strong">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1 sm:max-w-md">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Search identifiers and values…"
                aria-label="Search records"
                className="h-9 rounded-full pl-10"
              />
            </div>
            {activeFilters > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 px-2 text-xs font-medium text-accent hover:underline"
              >
                <X className="size-3" /> Clear all
              </button>
            )}
            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-fg-muted">
                {filtered.length === rows.length ? `${rows.length} records` : `Showing ${filtered.length} of ${rows.length} records`}
              </span>
              <div className="flex rounded-full bg-surface-2 p-1" role="radiogroup" aria-label="View">
                {(
                  [
                    ["cards", "Cards", LayoutGrid],
                    ["table", "Table", Rows3],
                  ] as const
                ).map(([id, label, Icon]) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={view === id}
                    onClick={() => setView(id)}
                    className={cn(
                      "relative flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors",
                      view === id ? "text-white" : "text-fg-muted hover:text-fg",
                    )}
                  >
                    {view === id && <motion.span layoutId="view-pill" className="absolute inset-0 rounded-full bg-primary-gradient" />}
                    <Icon className="relative size-3.5" aria-hidden />
                    <span className="relative">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2.5">
            <span className="mr-1 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
              <SlidersHorizontal className="size-3.5" aria-hidden /> Filters
            </span>
            {FILTER_NAMES.map((name) => (
              <MultiSelect
                key={name}
                variant="chip"
                label={`Filter by ${FILTER_LABELS[name]}`}
                placeholder={FILTER_LABELS[name]}
                values={filters[name]}
                options={options[name].map((v) => ({
                  value: v,
                  label: name === "country" && COUNTRY_NAMES[v] ? `${v} · ${COUNTRY_NAMES[v]}` : undefined,
                  summary: v,
                  hint: counts[name].get(v),
                }))}
                onChange={(values) => setFilter(name, values)}
                searchPlaceholder={`Search ${FILTER_LABELS[name].toLowerCase()}…`}
              />
            ))}
          </div>
        </Card>

        {filtered.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Database className="size-5" />}
              title={rows.length === 0 ? "No records yet" : "No records match your filters"}
              description={rows.length === 0 ? "Add a device or import a JSON file to get started." : "Try a different search or clear the filters."}
            />
          </Card>
        ) : view === "cards" ? (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {groups.map(({ device, rows: deviceRows }, i) => {
              const keys = deviceRows.map((r) => r.key);
              const allOn = keys.every((k) => selected.has(k));
              return (
                <motion.div
                  key={device}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.3) }}
                  onMouseMove={trackSpotlight}
                  className="glass spotlight group flex flex-col gap-3 rounded-3xl border p-4 shadow-card transition hover:-translate-y-1 hover:border-accent/35 hover:shadow-[0_12px_40px_var(--primary-glow)]"
                >
                  <div className="flex items-center gap-2">
                    {canEdit && (
                      <input
                        type="checkbox"
                        checked={allOn}
                        onChange={() => toggleSelected(keys)}
                        aria-label={`Select all records of ${device}`}
                        className="size-4 accent-[var(--primary-from)]"
                      />
                    )}
                    <p className="min-w-0 truncate font-display text-xl font-bold text-fg">{device}</p>
                    <span className="ml-auto shrink-0 text-xs text-fg-muted">
                      {deviceRows.length} record{deviceRows.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {deviceRows.map((row) => {
                      const tone = toneOf(tones, row.Hardware);
                      const on = selected.has(row.key);
                      return (
                        <div
                          key={row.key}
                          className={cn("group/tile relative rounded-2xl p-2.5 transition hover:scale-[1.02]", on && "ring-2 ring-accent")}
                          style={{ backgroundColor: tone.soft }}
                          title={row.key}
                        >
                          <TileBody editable={canEdit} onClick={() => edit(row)} disabled={row.device === "—"} label={`Edit ${row.key}`}>
                            <span className="block text-[11px] font-semibold text-fg-muted">{row.port}</span>
                            <span className="mt-0.5 block truncate text-[13px] font-bold" style={{ color: tone.fg }}>
                              {row.Hardware}
                            </span>
                            <span
                              className="mt-0.5 block truncate font-mono text-[10px] text-fg-muted"
                              title={`firmwareVersion: ${row.firmwareVersion}`}
                            >
                              fw {row.firmwareVersion}
                            </span>
                            <span className="block truncate font-mono text-[10px] text-fg-muted" title={`appVersion: ${row.appVersion}`}>
                              app {row.appVersion}
                            </span>
                            <span className="flex items-center justify-between gap-1 text-[10px] text-fg-subtle">
                              <span className="truncate">{row.Country}</span>
                              {canEdit && (
                                <Pencil className="size-3 shrink-0 opacity-0 transition-opacity group-hover/tile:opacity-100" aria-hidden />
                              )}
                            </span>
                          </TileBody>
                          {canEdit && (
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => toggleSelected([row.key])}
                              aria-label={`Select ${row.key}`}
                              className={cn(
                                "absolute right-2 top-2 size-3.5 accent-[var(--primary-from)] transition-opacity",
                                on ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100",
                              )}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              );
            })}
            {canEdit && (
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-border-strong text-sm font-semibold text-accent transition hover:border-accent/50 hover:bg-accent-soft"
              >
                <Plus className="size-6" aria-hidden />
                Add device
              </button>
            )}
          </div>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1140px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    {canEdit && (
                      <th scope="col" className="w-10 px-3 py-3">
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          onChange={() =>
                            toggleSelected(
                              visible.map((r) => r.key),
                              !allVisibleSelected,
                            )
                          }
                          aria-label="Select all records on this page"
                          className="size-4 accent-[var(--primary-from)]"
                        />
                      </th>
                    )}
                    {COLUMNS.map((col) => {
                      const active = sort.column === col.id;
                      const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                      return (
                        <th
                          key={col.id}
                          scope="col"
                          aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                          className={cn("px-3 py-3 text-xs font-medium text-fg-muted", col.className)}
                        >
                          <button type="button" onClick={() => toggleSort(col.id)} className="inline-flex items-center gap-1 hover:text-fg">
                            {col.label}
                            <Icon className={cn("size-3", !active && "opacity-40")} aria-hidden />
                          </button>
                        </th>
                      );
                    })}
                    {canEdit && (
                      <th scope="col" className="px-3 py-3 text-right text-xs font-medium text-fg-muted">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const on = selected.has(row.key);
                    return (
                      <tr
                        key={row.key}
                        className={cn("border-b border-border transition-colors last:border-0 hover:bg-accent-soft/50", on && "bg-accent-soft/60")}
                      >
                        {canEdit && (
                          <td className="px-3 py-2.5">
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => toggleSelected([row.key])}
                              aria-label={`Select ${row.key}`}
                              className="size-4 accent-[var(--primary-from)]"
                            />
                          </td>
                        )}
                        <td className="whitespace-nowrap px-3 py-2.5 font-semibold">{row.device}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-fg-muted">{row.port}</td>
                        <td className="break-all px-3 py-2.5 font-mono text-xs text-fg-muted">{row.key}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{row.sprintNo}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{row.Cver}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{row.firmwareVersion}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{row.appVersion}</td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <span className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={chipStyle(tones.get(row.Hardware))}>
                            {row.Hardware}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-fg-muted">{row.Country}</td>
                        {canEdit && (
                          <td className="whitespace-nowrap px-3 py-2.5 text-right">
                            <div className="inline-flex gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={`Edit ${row.key}`}
                                disabled={row.device === "—"}
                                title={row.device === "—" ? "This identifier does not follow the naming convention" : undefined}
                                onClick={() => edit(row)}
                                icon={<Pencil className="size-3.5" />}
                              >
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="danger-ghost"
                                aria-label={`Delete ${row.key}`}
                                disabled={writing}
                                onClick={() => setToDelete(row)}
                                icon={<Trash2 className="size-3.5" />}
                              />
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-fg-muted">
              <div className="flex items-center gap-2">
                Rows per page
                <NativeSelect
                  aria-label="Rows per page"
                  value={String(pageSize)}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="w-20"
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </NativeSelect>
                {canEdit && filtered.length > visible.length && (
                  <button
                    type="button"
                    className="ml-2 font-medium text-accent hover:underline"
                    onClick={() =>
                      toggleSelected(
                        filtered.map((r) => r.key),
                        true,
                      )
                    }
                  >
                    Select all {filtered.length} matching
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span>
                  {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}
                </span>
                <Button size="icon" variant="ghost" aria-label="Previous page" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
                  <ChevronLeft className="size-4" />
                </Button>
                <span>
                  Page {currentPage} / {pageCount}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Next page"
                  disabled={currentPage >= pageCount}
                  onClick={() => setPage(currentPage + 1)}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Floating selection bar */}
      <AnimatePresence>
        {canEdit && selectedKeys.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            className="fixed inset-x-0 bottom-5 z-30 flex justify-center px-4"
          >
            <div className="glass flex items-center gap-3 rounded-full border py-2 pl-5 pr-2 shadow-2xl" role="region" aria-label="Selection">
              <span className="text-sm font-semibold text-fg">{selectedKeys.length} selected</span>
              <Button variant="primary" size="sm" onClick={() => setBulkOpen(true)} icon={<Layers className="size-3.5" />}>
                Edit selected
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        size="xl"
        locked={writing}
        title={`Bulk edit ${selectedKeys.length} record${selectedKeys.length === 1 ? "" : "s"}`}
        description="Only the fields you fill in are changed. Untick any record to leave it out. Everything is saved in one commit."
      >
        <BulkEditForm
          embedded
          keys={selectedKeys}
          onCancel={() => setBulkOpen(false)}
          onSaved={() => {
            setBulkOpen(false);
            setSelected(new Set());
          }}
        />
      </Dialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(open) => !open && setToDelete(null)}
        title="Delete this record?"
        description="Only this exact record is removed. All other records stay unchanged."
        confirmLabel="Delete record"
        tone="danger"
        loading={writing}
        onConfirm={() => void confirmDelete()}
      >
        <p className="break-all rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs">{toDelete?.key}</p>
      </ConfirmDialog>
      <AddDeviceDialog open={addOpen} onOpenChange={setAddOpen} onCreated={(key) => navigate(`/?key=${encodeURIComponent(key)}`)} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </DataStateGate>
  );
}
