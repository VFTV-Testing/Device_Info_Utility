import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleSlash,
  History,
  LayoutGrid,
  Loader2,
  PencilLine,
  RefreshCw,
  Rows3,
  Search,
  ServerCrash,
  Undo2,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { naturalCompare } from "../../shared/deviceId";
import {
  ENV_CATEGORIES,
  ENV_CATEGORY_LABELS,
  ENV_STATUS_LABELS,
  ENV_STATUSES,
  entriesFor,
  latestEntry,
  MAX_NOTE_LENGTH,
  type EnvCategory,
  type EnvEntry,
  type EnvEntryInput,
  type EnvStatus,
} from "../../shared/environment";
import { DataStateGate } from "../components/common/DataStateGate";
import { commitToast } from "../components/device/RecordForm";
import { ConfirmDialog, Dialog } from "../components/ui/Dialog";
import { Badge, Button, Card, EmptyState, FieldLabel, Input, NativeSelect, Notice } from "../components/ui/primitives";
import { useDeviceData } from "../context/DeviceDataContext";
import { pendingId, useEnvironment } from "../context/EnvironmentContext";
import { useDebouncedValue } from "../hooks";
import { cn, formatTime, timeAgo } from "../lib/cn";
import { buildRows, COUNTRY_NAMES } from "../lib/deviceFilters";
import { ApiError } from "../services/api";

type PortState = EnvStatus | "none";
type StatusFilter = "all" | "problems" | EnvStatus;
type View = "cards" | "table";

interface PortRow {
  robot: string;
  port: string;
  /** Environment = country code of the port's records (e.g. "DE"); "—" when unknown. */
  env: string;
  platforms: string[];
  services: string[];
  entries: EnvEntry[];
  latest?: EnvEntry;
  state: PortState;
  /** An update collected but not pushed yet. */
  pending?: EnvEntryInput;
}

const STATE_STYLE: Record<PortState, { label: string; tone: string; dot: string; icon: typeof CheckCircle2 }> = {
  down: { label: "Down", tone: "bg-danger-soft text-danger", dot: "bg-danger", icon: ServerCrash },
  issue: { label: "Issue", tone: "bg-warning-soft text-warning", dot: "bg-warning", icon: AlertTriangle },
  ok: { label: "OK", tone: "bg-success-soft text-success", dot: "bg-success", icon: CheckCircle2 },
  none: { label: "No report", tone: "bg-surface-2 text-fg-muted", dot: "bg-border-strong", icon: CircleSlash },
};
const PROBLEM: PortState[] = ["down", "issue"];
const STATE_ORDER: Record<PortState, number> = { down: 0, issue: 1, ok: 2, none: 3 };
const VIEW_KEY = "dim-env-view";

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "table" ? "table" : "cards";
  } catch {
    return "cards";
  }
}

function StatusBadge({ state, className }: { state: PortState; className?: string }) {
  const s = STATE_STYLE[state];
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", s.tone, className)}>
      <Icon className="size-3" aria-hidden /> {s.label}
    </span>
  );
}

function PendingBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-accent/60 bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">
      <UploadCloud className="size-3" aria-hidden /> Pending
    </span>
  );
}

function Updated({ entry }: { entry?: EnvEntry }) {
  if (!entry) return <span className="text-fg-subtle">Never updated</span>;
  return (
    <span title={new Date(entry.at).toLocaleString()}>
      {timeAgo(entry.at)}
      {entry.by && <> · {entry.by}</>}
    </span>
  );
}

export function EnvironmentPage() {
  const { snapshot, config, autoSyncMs } = useDeviceData();
  const env = useEnvironment();
  const [envFilter, setEnvFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query.trim().toLowerCase(), 200);
  const [view, setViewState] = useState<View>(readView);
  const [editing, setEditing] = useState<PortRow | null>(null);
  const [viewingHistory, setViewingHistory] = useState<PortRow | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const refresh = env?.refresh;
  // Load when the tab opens, then keep in step with the app's auto-sync interval while it stays open.
  useEffect(() => {
    if (!refresh) return;
    void refresh();
    if (!autoSyncMs) return;
    const id = setInterval(() => {
      if (!document.hidden) void refresh();
    }, autoSyncMs);
    return () => clearInterval(id);
  }, [refresh, autoSyncMs]);

  const setView = (next: View) => {
    setViewState(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* per-browser convenience only */
    }
  };

  const doc = env?.data?.doc;
  const pending = env?.pending ?? {};
  const pendingCount = Object.keys(pending).length;
  const canEdit = Boolean(env?.data && !env.data.readOnly && !config?.viewOnly);

  /** Every robot port from the device file, plus any port that only exists in the environment file. */
  const ports = useMemo<PortRow[]>(() => {
    const map = new Map<string, PortRow>();
    for (const row of buildRows(snapshot?.data ?? {})) {
      if (row.device === "—") continue;
      const id = pendingId(row.device, row.port);
      const existing = map.get(id);
      if (existing) {
        if (!existing.platforms.includes(row.Hardware)) existing.platforms.push(row.Hardware);
        if (!existing.services.includes(row.service)) existing.services.push(row.service);
      } else {
        map.set(id, { robot: row.device, port: row.port, env: row.country, platforms: [row.Hardware], services: [row.service], entries: [], state: "none" });
      }
    }
    const extra = [...Object.entries(doc?.ports ?? {}).flatMap(([robot, byPort]) => Object.keys(byPort).map((port) => [robot, port] as const))];
    for (const p of Object.values(pending)) extra.push([p.robot, p.port]);
    for (const [robot, port] of extra) {
      const id = pendingId(robot, port);
      if (!map.has(id)) {
        // A robot whose other ports are known keeps its environment.
        const sibling = [...map.values()].find((p) => p.robot === robot);
        map.set(id, { robot, port, env: sibling?.env ?? "—", platforms: [], services: [], entries: [], state: "none" });
      }
    }
    for (const row of map.values()) {
      row.entries = doc ? entriesFor(doc, row.robot, row.port) : [];
      row.latest = latestEntry(row.entries);
      row.state = row.latest?.status ?? "none";
      row.pending = pending[pendingId(row.robot, row.port)];
    }
    return [...map.values()].sort((a, b) => naturalCompare(a.robot, b.robot) || naturalCompare(a.port, b.port));
  }, [snapshot, doc, pending]);

  const environments = useMemo(() => {
    const counts = new Map<string, { total: number; problems: number }>();
    for (const p of ports) {
      const c = counts.get(p.env) ?? { total: 0, problems: 0 };
      c.total++;
      if (PROBLEM.includes(p.state)) c.problems++;
      counts.set(p.env, c);
    }
    return [...counts.entries()].sort(([a], [b]) => naturalCompare(a, b)).map(([code, c]) => ({ code, ...c }));
  }, [ports]);

  const inEnv = useMemo(() => ports.filter((p) => envFilter === "all" || p.env === envFilter), [ports, envFilter]);
  const tally = useMemo(() => {
    const t: Record<PortState, number> = { down: 0, issue: 0, ok: 0, none: 0 };
    for (const p of inEnv) t[p.state]++;
    return t;
  }, [inEnv]);

  const shown = useMemo(
    () =>
      inEnv.filter((p) => {
        if (statusFilter === "problems" && !PROBLEM.includes(p.state)) return false;
        if (statusFilter !== "all" && statusFilter !== "problems") {
          // "OK" also covers ports nobody has reported on.
          if (statusFilter === "ok" ? !(p.state === "ok" || p.state === "none") : p.state !== statusFilter) return false;
        }
        if (!search) return true;
        const latest = p.latest;
        return [p.robot, p.port, ...p.platforms, ...p.services, latest?.note ?? "", latest ? ENV_CATEGORY_LABELS[latest.category] : "", p.pending?.note ?? ""].some((v) =>
          v.toLowerCase().includes(search),
        );
      }),
    [inEnv, statusFilter, search],
  );

  const robots = useMemo(() => {
    const groups = new Map<string, PortRow[]>();
    for (const p of shown) groups.set(p.robot, [...(groups.get(p.robot) ?? []), p]);
    return [...groups.entries()]
      .map(([robot, list]) => ({ robot, ports: list, worst: Math.min(...list.map((p) => STATE_ORDER[p.state])) }))
      .sort((a, b) => a.worst - b.worst || naturalCompare(a.robot, b.robot));
  }, [shown]);

  const tiles: { id: StatusFilter; label: string; value: number; tone: string }[] = [
    { id: "all", label: "All ports", value: inEnv.length, tone: "text-fg" },
    { id: "problems", label: "With problems", value: tally.down + tally.issue, tone: "text-warning" },
    { id: "down", label: "Down", value: tally.down, tone: "text-danger" },
    { id: "issue", label: "Issue", value: tally.issue, tone: "text-warning" },
    { id: "ok", label: "OK / no report", value: tally.ok + tally.none, tone: "text-success" },
  ];

  const portRows = useMemo(() => new Map(ports.map((p) => [pendingId(p.robot, p.port), p])), [ports]);

  return (
    <DataStateGate>
      <div className={cn("space-y-5", pendingCount > 0 && "pb-20")}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Environment</h2>
            <p className="mt-1 text-sm text-fg-muted">
              Problems per robot port — setup, Bluetooth, box, network and more. Every update is kept in the history.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void env?.refresh()} loading={env?.syncing} icon={<RefreshCw className="size-4" />}>
              Refresh
            </Button>
            {canEdit && (
              // Only highlighted when there is something to push.
              <Button
                variant={pendingCount ? "primary" : "secondary"}
                disabled={!pendingCount}
                onClick={() => setReviewOpen(true)}
                icon={<UploadCloud className="size-4" />}
                title={pendingCount ? "Review and push the pending updates" : "Nothing to push — update a port first"}
              >
                {pendingCount ? `Push ${pendingCount} update${pendingCount === 1 ? "" : "s"}` : "Push"}
              </Button>
            )}
          </div>
        </div>

        {!env ? (
          <Notice tone="warning" icon={<AlertTriangle className="size-4" />} title="Environment tracking is not set up for this site" />
        ) : env.error ? (
          <Notice
            tone="danger"
            icon={<AlertTriangle className="size-4" />}
            title="The environment status could not be loaded"
            actions={
              <Button size="sm" onClick={() => void env.refresh()} loading={env.syncing}>
                Try again
              </Button>
            }
          >
            {env.error.message}
          </Notice>
        ) : null}

        {env?.data?.readOnly && !config?.viewOnly && (
          <Notice tone="neutral" icon={<PencilLine className="size-4" />} title="You can view the environment status but not update it">
            Updating needs Write access to <code className="text-xs">{env.data.location}</code>.
          </Notice>
        )}

        {/* Environment = the one main filter */}
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Environment">
          {[{ code: "all", total: ports.length, problems: 0 }, ...environments].map((e) => {
            const active = envFilter === e.code;
            const problems = e.code === "all" ? ports.filter((p) => PROBLEM.includes(p.state)).length : e.problems;
            return (
              <button
                key={e.code}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setEnvFilter(e.code)}
                title={COUNTRY_NAMES[e.code]}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition",
                  active ? "border-transparent bg-primary-gradient text-white shadow-card" : "glass text-fg hover:border-accent/40",
                )}
              >
                {e.code === "all" ? "All environments" : e.code}
                <span className={cn("text-xs", active ? "text-white/80" : "text-fg-muted")}>{e.total}</span>
                {problems > 0 && (
                  <span className={cn("rounded-full px-1.5 text-[11px] font-bold", active ? "bg-white/25 text-white" : "bg-warning-soft text-warning")}>
                    {problems}⚠
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Status tiles double as the status filter */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5" role="radiogroup" aria-label="Status">
          {tiles.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={statusFilter === t.id}
              onClick={() => setStatusFilter(t.id)}
              className={cn(
                "glass rounded-2xl border p-4 text-left shadow-card transition hover:-translate-y-0.5",
                statusFilter === t.id ? "border-accent ring-2 ring-accent/30" : "hover:border-accent/30",
              )}
            >
              <span className="block text-xs text-fg-muted">{t.label}</span>
              <span className={cn("mt-1 block font-display text-3xl font-bold", t.tone)}>{t.value}</span>
            </button>
          ))}
        </div>

        <Card className="flex flex-wrap items-center gap-2 rounded-2xl p-3">
          <div className="relative min-w-[220px] flex-1 sm:max-w-md">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search robots, ports, notes…"
              aria-label="Search environment"
              className="h-9 rounded-full pl-10"
            />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-fg-muted">
              {shown.length} of {ports.length} ports
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
                  {view === id && <motion.span layoutId="env-view-pill" className="absolute inset-0 rounded-full bg-primary-gradient" />}
                  <Icon className="relative size-3.5" aria-hidden />
                  <span className="relative">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </Card>

        {env?.loading ? (
          <Card className="flex items-center justify-center gap-2 p-10 text-sm text-fg-muted">
            <Loader2 className="size-4 animate-spin" /> Loading environment status…
          </Card>
        ) : shown.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Activity className="size-5" />}
              title={statusFilter === "problems" || statusFilter === "down" || statusFilter === "issue" ? "No problems here" : "No ports match"}
              description={statusFilter !== "all" ? "Nothing is reported for this selection." : "Try another environment or search."}
            />
          </Card>
        ) : view === "cards" ? (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3">
            {robots.map(({ robot, ports: list }, i) => {
              const problems = list.filter((p) => PROBLEM.includes(p.state)).length;
              return (
                <motion.section
                  key={robot}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.3) }}
                  aria-label={robot}
                  className={cn(
                    "glass flex flex-col gap-3 rounded-3xl border p-4 shadow-card",
                    list.some((p) => p.state === "down") ? "border-danger/40" : problems ? "border-warning/40" : "",
                  )}
                >
                  <header className="flex items-center gap-2">
                    <h3 className="font-display text-xl font-bold text-fg">{robot}</h3>
                    {list[0]?.env && list[0].env !== "—" && <Badge>{list[0].env}</Badge>}
                    <span className="ml-auto text-xs text-fg-muted">
                      {problems ? (
                        <span className="font-semibold text-warning">
                          {problems} problem{problems === 1 ? "" : "s"}
                        </span>
                      ) : (
                        "All fine"
                      )}
                    </span>
                  </header>
                  <ul className="space-y-2">
                    {list.map((p) => (
                      <PortItem
                        key={p.port}
                        row={p}
                        canEdit={canEdit}
                        onEdit={() => setEditing(p)}
                        onHistory={() => setViewingHistory(p)}
                        onUndo={() => env?.unstage(p.robot, p.port)}
                      />
                    ))}
                  </ul>
                </motion.section>
              );
            })}
          </div>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-fg-muted">
                    {["Robot", "Device port", "Platform", "Stream type", "Status", "Issue type", "Issues", "Updated", ""].map((h) => (
                      <th key={h} scope="col" className="px-3 py-3 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => (
                    <tr
                      key={pendingId(p.robot, p.port)}
                      className={cn("border-b border-border align-top last:border-0 hover:bg-accent-soft/40", p.pending && "bg-accent-soft/50")}
                    >
                      <td className="whitespace-nowrap px-3 py-2.5 font-semibold">{p.robot}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-fg-muted">{p.port}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">{p.platforms.join(", ") || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-fg-muted">{p.services.join(", ") || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge state={p.state} />
                          {p.pending && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent">
                              <ArrowRight className="size-3" aria-hidden /> {ENV_STATUS_LABELS[p.pending.status]} (pending)
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-fg-muted">
                        {p.pending ? ENV_CATEGORY_LABELS[p.pending.category] : p.latest ? ENV_CATEGORY_LABELS[p.latest.category] : "—"}
                      </td>
                      <td className="max-w-[420px] whitespace-pre-line px-3 py-2.5 text-[13px]">
                        {(p.pending ? p.pending.note : p.latest?.note) || <span className="text-fg-subtle">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-fg-muted">{p.pending ? <PendingBadge /> : <Updated entry={p.latest} />}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        <div className="inline-flex gap-1">
                          {p.entries.length > 0 && (
                            <Button size="sm" variant="ghost" onClick={() => setViewingHistory(p)} aria-label={`History of ${p.robot} ${p.port}`} icon={<History className="size-3.5" />}>
                              {p.entries.length}
                            </Button>
                          )}
                          {canEdit && p.pending && (
                            <Button size="sm" variant="ghost" onClick={() => env?.unstage(p.robot, p.port)} aria-label={`Undo pending update of ${p.robot} ${p.port}`} icon={<Undo2 className="size-3.5" />} />
                          )}
                          {canEdit && (
                            <Button size="sm" variant="ghost" onClick={() => setEditing(p)} aria-label={`Update ${p.robot} ${p.port}`} icon={<PencilLine className="size-3.5" />}>
                              Update
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {/* Pending bar — only while there is something to push */}
      <AnimatePresence>
        {canEdit && pendingCount > 0 && (
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }} className="fixed inset-x-0 bottom-5 z-30 flex justify-center px-4">
            <div className="glass-strong flex flex-wrap items-center gap-3 rounded-full border py-2 pl-5 pr-2 shadow-2xl" role="region" aria-label="Pending updates">
              <span className="text-sm font-semibold text-fg">
                {pendingCount} pending update{pendingCount === 1 ? "" : "s"}
              </span>
              <span className="hidden text-xs text-fg-muted sm:inline">not saved to GitHub yet</span>
              <Button variant="ghost" size="sm" onClick={() => setDiscardOpen(true)} disabled={env?.writing}>
                Discard all
              </Button>
              <Button variant="primary" size="sm" onClick={() => setReviewOpen(true)} icon={<UploadCloud className="size-3.5" />}>
                Review & push
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <UpdateDialog row={editing} onClose={() => setEditing(null)} />
      <HistoryDialog row={viewingHistory} onClose={() => setViewingHistory(null)} />
      <ReviewDialog open={reviewOpen} onClose={() => setReviewOpen(false)} rows={portRows} />
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard all pending updates?"
        description="They were not pushed, so nothing in GitHub changes."
        confirmLabel="Discard all"
        tone="danger"
        onConfirm={() => {
          env?.discardAll();
          setDiscardOpen(false);
        }}
      />
    </DataStateGate>
  );
}

function PortItem({
  row,
  canEdit,
  onEdit,
  onHistory,
  onUndo,
}: {
  row: PortRow;
  canEdit: boolean;
  onEdit: () => void;
  onHistory: () => void;
  onUndo: () => void;
}) {
  const problem = PROBLEM.includes(row.state);
  const pending = row.pending;
  return (
    <li
      className={cn(
        "rounded-2xl border p-3 transition",
        row.state === "down" ? "border-danger/30 bg-danger-soft/60" : row.state === "issue" ? "border-warning/30 bg-warning-soft/60" : "border-border bg-surface/50",
        pending && "border-dashed border-accent/60 ring-1 ring-accent/30",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-fg">{row.port}</span>
        {row.platforms.length > 0 && <span className="text-xs text-fg-muted">{row.platforms.join(", ")}</span>}
        <StatusBadge state={row.state} className="ml-auto" />
      </div>
      {row.latest && (problem || row.latest.note) && (
        <div className="mt-2">
          {problem && <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{ENV_CATEGORY_LABELS[row.latest.category]}</span>}
          {row.latest.note && <p className={cn("mt-0.5 line-clamp-4 whitespace-pre-line text-[13px]", problem ? "text-fg" : "text-fg-muted")}>{row.latest.note}</p>}
        </div>
      )}
      {pending && (
        <div className="mt-2 rounded-xl border border-dashed border-accent/50 bg-accent-soft/70 p-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <PendingBadge />
            <ArrowRight className="size-3 text-fg-subtle" aria-hidden />
            <StatusBadge state={pending.status} />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{ENV_CATEGORY_LABELS[pending.category]}</span>
          </div>
          {pending.note && <p className="mt-1 line-clamp-4 whitespace-pre-line text-[13px] text-fg">{pending.note}</p>}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 text-[11px] text-fg-muted">
        <Updated entry={row.latest} />
        <span className="ml-auto inline-flex gap-1">
          {row.entries.length > 0 && (
            <button type="button" onClick={onHistory} className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 font-medium hover:bg-surface-2 hover:text-fg" aria-label={`History of ${row.robot} ${row.port}`}>
              <History className="size-3.5" aria-hidden /> {row.entries.length}
            </button>
          )}
          {canEdit && pending && (
            <button type="button" onClick={onUndo} className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 font-medium hover:bg-surface-2 hover:text-fg" aria-label={`Undo pending update of ${row.robot} ${row.port}`}>
              <Undo2 className="size-3.5" aria-hidden /> Undo
            </button>
          )}
          {canEdit && (
            <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 font-semibold text-accent hover:bg-accent-soft" aria-label={`Update ${row.robot} ${row.port}`}>
              <PencilLine className="size-3.5" aria-hidden /> {pending ? "Edit" : "Update"}
            </button>
          )}
        </span>
      </div>
    </li>
  );
}

function UpdateDialog({ row, onClose }: { row: PortRow | null; onClose: () => void }) {
  const env = useEnvironment();
  const [status, setStatus] = useState<EnvStatus>("issue");
  const [category, setCategory] = useState<EnvCategory>("environment");
  const [note, setNote] = useState("");

  // Start from the pending change (if any), else the port's current state, so a small change is a small edit.
  const base = row?.pending ?? row?.latest;
  useEffect(() => {
    if (!row) return;
    const from = row.pending ?? row.latest;
    setStatus(from?.status ?? "issue");
    setCategory(from?.category ?? "environment");
    setNote(from?.note ?? "");
  }, [row]);

  const same = (a?: { status: EnvStatus; category: EnvCategory; note: string }) =>
    Boolean(a && a.status === status && a.category === category && a.note === note.trim());
  const unchanged = same(base);
  const needsNote = status !== "ok" && note.trim() === "";

  const add = () => {
    if (!row || !env) return;
    // Setting a port back to what is already saved simply drops its pending change.
    if (same(row.latest)) env.unstage(row.robot, row.port);
    else env.stage({ robot: row.robot, port: row.port, status, category, note });
    onClose();
  };

  return (
    <Dialog
      open={Boolean(row)}
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title={row ? `Update ${row.robot} · ${row.port}` : "Update"}
      description="Added to your pending updates — nothing is saved until you press Push."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={add} disabled={unchanged || needsNote}>
            {row?.pending ? "Update pending" : "Add to pending"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <FieldLabel>Status</FieldLabel>
          <div className="flex rounded-xl bg-surface-2 p-1" role="radiogroup" aria-label="Status">
            {ENV_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={status === s}
                onClick={() => setStatus(s)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition",
                  status === s ? cn(STATE_STYLE[s].tone, "shadow-card ring-1 ring-current/20") : "text-fg-muted hover:text-fg",
                )}
              >
                {ENV_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <FieldLabel htmlFor="env-category">Issue type</FieldLabel>
          <NativeSelect id="env-category" value={category} onChange={(e) => setCategory(e.target.value as EnvCategory)} className="[&_select]:h-10">
            {ENV_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {ENV_CATEGORY_LABELS[c]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <FieldLabel htmlFor="env-note" hint={`${note.length} / ${MAX_NOTE_LENGTH}`}>
            {status === "ok" ? "Note (optional)" : "What is the problem?"}
          </FieldLabel>
          <textarea
            id="env-note"
            value={note}
            maxLength={MAX_NOTE_LENGTH}
            onChange={(e) => setNote(e.target.value)}
            rows={6}
            placeholder={status === "ok" ? "e.g. Router rebooted, all channels working again" : "e.g. No internet on the box since 27/4 — MCAST live not working, OTT fine"}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-fg transition placeholder:text-fg-subtle hover:border-border-strong focus:border-accent focus:outline-none focus:ring-4 focus:ring-ring"
          />
          {needsNote && <p className="mt-1 text-xs text-fg-muted">Describe the issue so others know what is wrong.</p>}
        </div>
      </div>
    </Dialog>
  );
}

function ReviewDialog({ open, onClose, rows }: { open: boolean; onClose: () => void; rows: Map<string, PortRow> }) {
  const env = useEnvironment();
  const { config } = useDeviceData();
  const [error, setError] = useState<string | null>(null);
  const pending = Object.entries(env?.pending ?? {}).sort(([a], [b]) => naturalCompare(a, b));
  const count = pending.length;

  useEffect(() => {
    if (open) setError(null);
  }, [open]);
  // Nothing left to review (all removed) → close.
  useEffect(() => {
    if (open && count === 0 && !env?.writing) onClose();
  }, [open, count, env?.writing, onClose]);

  const push = async () => {
    if (!env) return;
    setError(null);
    try {
      const result = await env.pushPending();
      commitToast(`${count} environment update${count === 1 ? "" : "s"} pushed`, result.commit, config?.storage === "local");
      onClose();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "The updates could not be pushed.";
      setError(message);
      toast.error("Not pushed — your pending updates are kept", { description: message });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      locked={env?.writing}
      size="lg"
      title={`Push ${count} update${count === 1 ? "" : "s"}`}
      description="All of these are saved to GitHub together, in one commit. Each becomes a new history entry."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={env?.writing}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void push()} loading={env?.writing} disabled={!count} icon={<UploadCloud className="size-4" />}>
            {env?.writing ? "Pushing…" : `Push ${count} update${count === 1 ? "" : "s"}`}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && (
          <Notice tone="danger" icon={<AlertTriangle className="size-4" />} title="Not pushed — your pending updates are kept">
            {error}
          </Notice>
        )}
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {pending.map(([id, p]) => {
            const current = rows.get(id);
            return (
              <li key={id} className="flex gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold text-fg">
                      {p.robot} · {p.port}
                    </span>
                    <StatusBadge state={current?.state ?? "none"} />
                    <ArrowRight className="size-3 text-fg-subtle" aria-hidden />
                    <StatusBadge state={p.status} />
                    <span className="text-xs text-fg-muted">{ENV_CATEGORY_LABELS[p.category]}</span>
                  </div>
                  {p.note && <p className="mt-1 whitespace-pre-line text-[13px] text-fg">{p.note}</p>}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={env?.writing}
                  onClick={() => env?.unstage(p.robot, p.port)}
                  aria-label={`Remove ${p.robot} ${p.port} from this push`}
                  title="Remove from this push"
                >
                  <X className="size-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      </div>
    </Dialog>
  );
}

function HistoryDialog({ row, onClose }: { row: PortRow | null; onClose: () => void }) {
  const entries = row ? [...row.entries].reverse() : [];
  return (
    <Dialog
      open={Boolean(row)}
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title={row ? `History · ${row.robot} · ${row.port}` : "History"}
      description={row ? `${row.entries.length} update${row.entries.length === 1 ? "" : "s"}, newest first.` : undefined}
    >
      <ol className="relative space-y-4 border-l border-border pl-5">
        {entries.map((e, i) => (
          <HistoryItem key={`${e.at}-${i}`} entry={e} current={i === 0} />
        ))}
      </ol>
    </Dialog>
  );
}

function HistoryItem({ entry, current }: { entry: EnvEntry; current: boolean }): ReactNode {
  return (
    <li className="relative">
      <span className={cn("absolute -left-[26px] top-1.5 size-2.5 rounded-full ring-4 ring-surface", STATE_STYLE[entry.status].dot)} aria-hidden />
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge state={entry.status} />
        <span className="text-xs font-medium text-fg-muted">{ENV_CATEGORY_LABELS[entry.category]}</span>
        {current && <Badge tone="accent">Current</Badge>}
        <span className="ml-auto text-xs text-fg-subtle" title={new Date(entry.at).toLocaleString()}>
          {new Date(entry.at).toLocaleDateString()} {formatTime(entry.at)}
          {entry.by && <> · {entry.by}</>}
        </span>
      </div>
      {entry.note && <p className="mt-1.5 whitespace-pre-line text-[13px] text-fg">{entry.note}</p>}
    </li>
  );
}
