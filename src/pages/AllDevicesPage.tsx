import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Database, FileUp, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { naturalCompare, parseDeviceId } from "../../shared/deviceId";
import type { DeviceRecord } from "../../shared/types";
import { pickRecord } from "../../shared/validation";
import { DataStateGate } from "../components/common/DataStateGate";
import { commitToast } from "../components/device/RecordForm";
import { AddDeviceDialog } from "../components/dialogs/AddDeviceDialog";
import { ImportDialog } from "../components/dialogs/ImportDialog";
import { ConfirmDialog } from "../components/ui/Dialog";
import { Button, Card, EmptyState, Input, NativeSelect } from "../components/ui/primitives";
import { useDeviceData } from "../context/DeviceDataContext";
import { useDebouncedValue } from "../hooks";
import { cn } from "../lib/cn";
import { ApiError } from "../services/api";

interface Row extends DeviceRecord {
  key: string;
  device: string;
  port: string;
}

type SortColumn = "device" | "port" | "key" | keyof DeviceRecord;
const COLUMNS: { id: SortColumn; label: string; mono?: boolean; className?: string }[] = [
  { id: "device", label: "Device" },
  { id: "port", label: "Port" },
  { id: "key", label: "Full Device Identifier", mono: true, className: "min-w-[280px]" },
  { id: "sprintNo", label: "sprintNo", mono: true },
  { id: "Cver", label: "Cver", mono: true },
  { id: "firmwareVersion", label: "firmwareVersion", mono: true },
  { id: "appVersion", label: "appVersion", mono: true },
  { id: "Hardware", label: "Hardware" },
  { id: "Country", label: "Country" },
];
const PAGE_SIZES = [10, 25, 50, 100];

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort(naturalCompare);
}

export function AllDevicesPage() {
  const { snapshot, refresh, syncing, deleteRecord, writing, config } = useDeviceData();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({ device: "", port: "", Hardware: "", Country: "" });
  const [sort, setSort] = useState<{ column: SortColumn; dir: "asc" | "desc" }>({ column: "key", dir: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [toDelete, setToDelete] = useState<Row | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const search = useDebouncedValue(query.trim().toLowerCase(), 200);

  const rows = useMemo<Row[]>(
    () =>
      Object.entries(snapshot?.data ?? {}).map(([key, record]) => {
        const id = parseDeviceId(key);
        return { key, device: id?.device ?? "—", port: id?.port ?? "—", ...record };
      }),
    [snapshot],
  );

  const options = useMemo(
    () => ({
      device: uniqueSorted(rows.map((r) => r.device)),
      port: uniqueSorted(rows.map((r) => r.port)),
      Hardware: uniqueSorted(rows.map((r) => r.Hardware)),
      Country: uniqueSorted(rows.map((r) => r.Country)),
    }),
    [rows],
  );

  const filtered = useMemo(() => {
    const result = rows.filter((row) => {
      if (filters.device && row.device !== filters.device) return false;
      if (filters.port && row.port !== filters.port) return false;
      if (filters.Hardware && row.Hardware !== filters.Hardware) return false;
      if (filters.Country && row.Country !== filters.Country) return false;
      if (!search) return true;
      return [row.key, row.sprintNo, row.Cver, row.firmwareVersion, row.appVersion, row.Hardware, row.Country].some((v) =>
        v.toLowerCase().includes(search),
      );
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    return result.sort((a, b) => dir * naturalCompare(a[sort.column], b[sort.column]) || naturalCompare(a.key, b.key));
  }, [rows, filters, search, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const activeFilters = Object.values(filters).filter(Boolean).length + (query ? 1 : 0);

  const setFilter = (name: keyof typeof filters, value: string) => {
    setFilters((f) => ({ ...f, [name]: value }));
    setPage(1);
  };

  const toggleSort = (column: SortColumn) =>
    setSort((s) => (s.column === column ? { column, dir: s.dir === "asc" ? "desc" : "asc" } : { column, dir: "asc" }));

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      const result = await deleteRecord(toDelete.key, pickRecord(toDelete));
      commitToast(config?.storage === "local" ? "Record deleted" : "Record deleted in GitHub", result.commit, config?.storage === "local");
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
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">All Devices</h2>
            <p className="mt-1 text-sm text-fg-muted">
              <strong className="text-fg">{rows.length}</strong> records in deviceInformation.json
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void refresh()} loading={syncing} icon={<RefreshCw className="size-4" />}>
              Refresh
            </Button>
            <Button onClick={() => setImportOpen(true)} icon={<FileUp className="size-4" />}>
              Import JSON
            </Button>
            <Button variant="primary" onClick={() => setAddOpen(true)} icon={<Plus className="size-4" />}>
              Add device
            </Button>
          </div>
        </div>

        <Card>
          <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-6">
            <div className="relative sm:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Search identifiers and values…"
                aria-label="Search records"
                className="h-9 pl-9"
              />
            </div>
            {(["device", "port", "Hardware", "Country"] as const).map((name) => (
              <NativeSelect key={name} aria-label={`Filter by ${name}`} value={filters[name]} onChange={(e) => setFilter(name, e.target.value)}>
                <option value="">{`All ${name === "device" ? "devices" : name === "port" ? "ports" : name}`}</option>
                {options[name].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </NativeSelect>
            ))}
          </div>

          {activeFilters > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs text-fg-muted">
              Showing {filtered.length} of {rows.length} records
              <button
                type="button"
                className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                onClick={() => {
                  setQuery("");
                  setFilters({ device: "", port: "", Hardware: "", Country: "" });
                  setPage(1);
                }}
              >
                <X className="size-3" /> Clear filters
              </button>
            </div>
          )}

          {filtered.length === 0 ? (
            <EmptyState
              icon={<Database className="size-5" />}
              title={rows.length === 0 ? "No records yet" : "No records match your filters"}
              description={rows.length === 0 ? "Add a device or import a JSON file to get started." : "Try a different search or clear the filters."}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2/60 text-left">
                    {COLUMNS.map((col) => {
                      const active = sort.column === col.id;
                      const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                      return (
                        <th
                          key={col.id}
                          scope="col"
                          aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                          className={cn("px-3 py-2.5 text-xs font-medium text-fg-muted", col.className)}
                        >
                          <button type="button" onClick={() => toggleSort(col.id)} className="inline-flex items-center gap-1 hover:text-fg">
                            {col.label}
                            <Icon className={cn("size-3", !active && "opacity-40")} aria-hidden />
                          </button>
                        </th>
                      );
                    })}
                    <th scope="col" className="px-3 py-2.5 text-right text-xs font-medium text-fg-muted">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.key} className="border-b border-border last:border-0 hover:bg-surface-2/50">
                      <td className="whitespace-nowrap px-3 py-2.5 font-medium">{row.device}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">{row.port}</td>
                      <td className="break-all px-3 py-2.5 font-mono text-xs text-fg-muted">{row.key}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{row.sprintNo}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{row.Cver}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{row.firmwareVersion}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{row.appVersion}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">{row.Hardware}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">{row.Country}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        <div className="inline-flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Edit ${row.key}`}
                            disabled={row.device === "—"}
                            title={row.device === "—" ? "This identifier does not follow the naming convention" : undefined}
                            onClick={() => navigate(`/?key=${encodeURIComponent(row.key)}`)}
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

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
            </div>
            <div className="flex items-center gap-2">
              <span>
                {filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}
              </span>
              <Button size="icon" variant="ghost" aria-label="Previous page" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
                <ChevronLeft className="size-4" />
              </Button>
              <span>
                Page {currentPage} / {pageCount}
              </span>
              <Button size="icon" variant="ghost" aria-label="Next page" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </Card>
      </div>

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
