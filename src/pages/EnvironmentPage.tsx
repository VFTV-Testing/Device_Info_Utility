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
  Settings2,
  Undo2,
  UploadCloud,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { naturalCompare } from "../../shared/deviceId";
import { activeSchema, hasField } from "../../shared/schema";
import {
  ENV_CATEGORIES,
  ENV_CATEGORY_LABELS,
  ENV_STATUS_LABELS,
  ENV_STATUSES,
  entriesFor,
  latestEntry,
  MAX_NOTE_LENGTH,
  MAX_SETUP_LENGTH,
  setupFor,
  type EnvCategory,
  type EnvEntry,
  type EnvEntryInput,
  type EnvStatus,
  type SetupEntry,
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
type StatusFilter = "all" | EnvStatus;
type View = "cards" | "table";

interface PortRow {
  robot: string;
  port: string;
  /** Environment = country code of the port's records (e.g. "DE"); "—" when unknown. */
  env: string;
  platforms: string[];
  services: string[];
  /** Status history (oldest first) and the current status. */
  entries: EnvEntry[];
  latest?: EnvEntry;
  state: PortState;
  /** Setup-info history and the current setup ("" = none). */
  setupEntries: SetupEntry[];
  setup: string;
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

/** Issue type label — only Issue / Down have one. */
function issueType(entry?: { status?: EnvStatus; category?: EnvCategory }): string | null {
  return entry?.status && entry.status !== "ok" && entry.category ? ENV_CATEGORY_LABELS[entry.category] : null;
}

/** Setup info as shown: the pending value when there is one, else the saved one. */
function shownSetup(row: PortRow): string {
  return row.pending?.setup !== undefined ? row.pending.setup : row.setup;
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

/** The always-visible setup line (router/port, VLAN, modem, Wi-Fi…). */
function SetupLine({ row, className }: { row: PortRow; className?: string }) {
  const text = shownSetup(row);
  const pending = row.pending?.setup !== undefined && row.pending.setup !== row.setup;
  if (!text && !pending) return null;
  return (
    <p className={cn("flex items-start gap-1.5 text-xs", pending ? "font-medium text-accent" : "text-fg-muted", className)} title="Setup info">
      <Settings2 className="mt-px size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 whitespace-pre-line">
        {text || <em>Setup cleared</em>}
        {pending && <span className="ml-1 text-[11px]">(pending)</span>}
      </span>
    </p>
  );
}

function Updated({ entry }: { entry?: { at: string; by?: string } }) {
  if (!entry) return <span className="text-fg-subtle">Never updated</span>;
  return (
    <span title={new Date(entry.at).toLocaleString()}>
      {timeAgo(entry.at)}
      {entry.by && <> · by <span className="font-medium text-fg-muted">{entry.by}</span></>}
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
  // View-only readers get a read-only client; moderators and team members can update.
  const canEdit = Boolean(env?.data && !env.data.readOnly);
  /** Setup info stays with the team: moderators change status only. */
  const canEditSetup = !config?.moderator;

  /** Every robot port from the device file, plus any port that only exists in the environment file. */
  const ports = useMemo<PortRow[]>(() => {
    const blank = (robot: string, port: string, envCode: string): PortRow => ({
      robot,
      port,
      env: envCode,
      platforms: [],
      services: [],
      entries: [],
      state: "none",
      setupEntries: [],
      setup: "",
    });
    const map = new Map<string, PortRow>();
    for (const row of buildRows(snapshot?.data ?? {})) {
      if (row.device === "—") continue;
      const id = pendingId(row.device, row.port);
      const existing = map.get(id) ?? blank(row.device, row.port, row.country);
      if (!existing.platforms.includes(row.Hardware)) existing.platforms.push(row.Hardware);
      if (!existing.services.includes(row.service)) existing.services.push(row.service);
      map.set(id, existing);
    }
    // The environment file is shared by every device family. Show only this family's robots;
    // STB (the original family) also keeps ports whose robot is no longer in any device file.
    const familyRobots = new Set([...map.values()].map((p) => p.robot));
    const keepUnknownRobots = activeSchema().id === "stb";
    const extra = [doc?.ports ?? {}, doc?.setup ?? {}]
      .flatMap((m) => Object.entries(m).flatMap(([robot, byPort]) => Object.keys(byPort).map((port) => [robot, port] as const)))
      .filter(([robot]) => keepUnknownRobots || familyRobots.has(robot));
    for (const p of Object.values(pending)) extra.push([p.robot, p.port]);
    for (const [robot, port] of extra) {
      const id = pendingId(robot, port);
      if (!map.has(id)) {
        // A robot whose other ports are known keeps its environment.
        const sibling = [...map.values()].find((p) => p.robot === robot);
        map.set(id, blank(robot, port, sibling?.env ?? "—"));
      }
    }
    for (const row of map.values()) {
      row.entries = doc ? entriesFor(doc, row.robot, row.port) : [];
      row.latest = latestEntry(row.entries);
      row.state = row.latest?.status ?? "none";
      row.setupEntries = doc ? setupFor(doc, row.robot, row.port) : [];
      row.setup = row.setupEntries[row.setupEntries.length - 1]?.note ?? "";
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
        if (statusFilter !== "all") {
          // "OK" also covers ports nobody has reported on.
          if (statusFilter === "ok" ? PROBLEM.includes(p.state) : p.state !== statusFilter) return false;
        }
        if (!search) return true;
        return [p.robot, p.port, ...p.platforms, ...p.services, p.latest?.note ?? "", issueType(p.latest) ?? "", shownSetup(p), p.pending?.note ?? ""].some((v) =>
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
              Setup and current status per robot port — setup, Bluetooth, box, network and more. Every change is kept in the history.
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

        {/* Environment = the one main filter (families without a Country field have no environments) */}
        {hasField("Country") && (
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
        )}

        {/* Status tiles double as the status filter */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="radiogroup" aria-label="Status">
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
              placeholder="Search robots, ports, setup, notes…"
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
              title={statusFilter === "down" || statusFilter === "issue" ? "No problems here" : "No ports match"}
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
              <table className="w-full min-w-[1150px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-fg-muted">
                    {["Robot", "Device port", "Platform", "Stream type", "Setup", "Status", "Issue type", "Issues", "Updated", ""].map((h) => (
                      <th key={h} scope="col" className="px-3 py-3 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => {
                    const pendingStatus = p.pending?.status ? p.pending : undefined;
                    return (
                      <tr
                        key={pendingId(p.robot, p.port)}
                        className={cn("border-b border-border align-top last:border-0 hover:bg-accent-soft/40", p.pending && "bg-accent-soft/50")}
                      >
                        <td className="whitespace-nowrap px-3 py-2.5 font-semibold">{p.robot}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-fg-muted">{p.port}</td>
                        <td className="whitespace-nowrap px-3 py-2.5">{p.platforms.join(", ") || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-fg-muted">{p.services.join(", ") || "—"}</td>
                        <td className="max-w-[220px] px-3 py-2.5 text-xs text-fg-muted">
                          <SetupLine row={p} /> {!shownSetup(p) && !p.pending?.setup && <span className="text-fg-subtle">—</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <div className="flex flex-col items-start gap-1">
                            <StatusBadge state={p.state} />
                            {pendingStatus?.status && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent">
                                <ArrowRight className="size-3" aria-hidden /> {ENV_STATUS_LABELS[pendingStatus.status]} (pending)
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-fg-muted">{(pendingStatus ? issueType(pendingStatus) : issueType(p.latest)) ?? "—"}</td>
                        <td className="max-w-[380px] whitespace-pre-line px-3 py-2.5 text-[13px]">
                          {(pendingStatus ? pendingStatus.note : p.latest?.note) || <span className="text-fg-subtle">—</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-xs text-fg-muted">{p.pending ? <PendingBadge /> : <Updated entry={p.latest} />}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right">
                          <div className="inline-flex gap-1">
                            {p.entries.length + p.setupEntries.length > 0 && (
                              <Button size="sm" variant="ghost" onClick={() => setViewingHistory(p)} aria-label={`History of ${p.robot} ${p.port}`} icon={<History className="size-3.5" />}>
                                {p.entries.length + p.setupEntries.length}
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
                    );
                  })}
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

      <UpdateDialog row={editing} onClose={() => setEditing(null)} canEditSetup={canEditSetup} />
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
  const pendingStatus = row.pending?.status ? row.pending : undefined;
  const historyCount = row.entries.length + row.setupEntries.length;
  return (
    <li
      className={cn(
        "rounded-2xl border p-3 transition",
        row.state === "down" ? "border-danger/30 bg-danger-soft/60" : row.state === "issue" ? "border-warning/30 bg-warning-soft/60" : "border-border bg-surface/50",
        row.pending && "border-dashed border-accent/60 ring-1 ring-accent/30",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-fg">{row.port}</span>
        {row.platforms.length > 0 && <span className="text-xs text-fg-muted">{row.platforms.join(", ")}</span>}
        <StatusBadge state={row.state} className="ml-auto" />
      </div>
      <SetupLine row={row} className="mt-1.5" />
      {/* Only the latest status is shown here; older ones are in the history. */}
      {row.latest && (issueType(row.latest) || row.latest.note) && (
        <div className="mt-2">
          {issueType(row.latest) && <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{issueType(row.latest)}</span>}
          {row.latest.note && <p className="mt-0.5 line-clamp-4 whitespace-pre-line text-[13px] text-fg">{row.latest.note}</p>}
        </div>
      )}
      {pendingStatus?.status && (
        <div className="mt-2 rounded-xl border border-dashed border-accent/50 bg-accent-soft/70 p-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <PendingBadge />
            <ArrowRight className="size-3 text-fg-subtle" aria-hidden />
            <StatusBadge state={pendingStatus.status} />
            {issueType(pendingStatus) && <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{issueType(pendingStatus)}</span>}
          </div>
          {pendingStatus.note && <p className="mt-1 line-clamp-4 whitespace-pre-line text-[13px] text-fg">{pendingStatus.note}</p>}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 text-[11px] text-fg-muted">
        <Updated entry={row.latest} />
        <span className="ml-auto inline-flex gap-1">
          {historyCount > 0 && (
            <button type="button" onClick={onHistory} className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 font-medium hover:bg-surface-2 hover:text-fg" aria-label={`History of ${row.robot} ${row.port}`}>
              <History className="size-3.5" aria-hidden /> {historyCount}
            </button>
          )}
          {canEdit && row.pending && (
            <button type="button" onClick={onUndo} className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 font-medium hover:bg-surface-2 hover:text-fg" aria-label={`Undo pending update of ${row.robot} ${row.port}`}>
              <Undo2 className="size-3.5" aria-hidden /> Undo
            </button>
          )}
          {canEdit && (
            <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 font-semibold text-accent hover:bg-accent-soft" aria-label={`Update ${row.robot} ${row.port}`}>
              <PencilLine className="size-3.5" aria-hidden /> {row.pending ? "Edit" : "Update"}
            </button>
          )}
        </span>
      </div>
    </li>
  );
}

function UpdateDialog({ row, onClose, canEditSetup }: { row: PortRow | null; onClose: () => void; canEditSetup: boolean }) {
  const env = useEnvironment();
  const [setup, setSetup] = useState("");
  const [status, setStatus] = useState<EnvStatus>("ok");
  const [category, setCategory] = useState<EnvCategory>("environment");
  const [note, setNote] = useState("");

  // Start from the pending change (if any), else what is saved, so a small change is a small edit.
  useEffect(() => {
    if (!row) return;
    const from = row.pending?.status ? row.pending : row.latest;
    setSetup(row.pending?.setup ?? row.setup);
    setStatus(from?.status ?? "ok");
    setCategory(from?.category ?? "environment");
    setNote(from?.note ?? "");
  }, [row]);

  const setupChanged = canEditSetup && Boolean(row) && setup.trim() !== (row?.setup ?? "");
  const latest = row?.latest;
  // A port with no report only gets a status entry when something is actually said about it.
  const statusChanged = latest
    ? latest.status !== status || (status !== "ok" && latest.category !== category) || latest.note !== note.trim()
    : status !== "ok" || note.trim() !== "";
  const needsNote = status !== "ok" && note.trim() === "";
  const base = row?.pending;
  const sameAsPending =
    Boolean(base) &&
    (base?.setup ?? null) === (setupChanged ? setup.trim() : null) &&
    (base?.status ?? null) === (statusChanged ? status : null) &&
    (!statusChanged || ((base?.note ?? "") === note.trim() && (status === "ok" || base?.category === category)));

  const add = () => {
    if (!row || !env) return;
    if (!setupChanged && !statusChanged) {
      // Back to what is already saved → nothing pending for this port.
      env.unstage(row.robot, row.port);
    } else {
      env.stage({
        robot: row.robot,
        port: row.port,
        ...(statusChanged ? { status, ...(status !== "ok" ? { category } : {}), note } : {}),
        ...(setupChanged ? { setup } : {}),
      });
    }
    onClose();
  };

  const nothingToDo = !row?.pending && !setupChanged && !statusChanged;

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
          <Button variant="primary" onClick={add} disabled={nothingToDo || sameAsPending || (statusChanged && needsNote)}>
            {row?.pending ? "Update pending" : "Add to pending"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="rounded-2xl border border-border bg-surface-2/50 p-3">
          <FieldLabel htmlFor="env-setup" hint={`${setup.length} / ${MAX_SETUP_LENGTH}`}>
            <span className="inline-flex items-center gap-1.5">
              <Settings2 className="size-3.5" aria-hidden /> Setup info
            </span>
          </FieldLabel>
          <Input
            id="env-setup"
            value={setup}
            maxLength={MAX_SETUP_LENGTH}
            disabled={!canEditSetup}
            onChange={(e) => setSetup(e.target.value)}
            placeholder={canEditSetup ? "e.g. Router 3 Port2 · VLAN 202 · Manual device · Wi-Fi VCOE8" : "—"}
          />
          <p className="mt-1 text-xs text-fg-muted">
            {canEditSetup ? "Permanent facts about this port. Always shown on the card, whatever the status." : "Set by the team. Moderators can't change it."}
          </p>
        </div>

        <div>
          <FieldLabel>Status</FieldLabel>
          <div className="flex rounded-xl bg-surface-2 p-1" role="radiogroup" aria-label="Status">
            {ENV_STATUSES.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={status === k}
                onClick={() => setStatus(k)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition",
                  status === k ? cn(STATE_STYLE[k].tone, "shadow-card ring-1 ring-current/20") : "text-fg-muted hover:text-fg",
                )}
              >
                {ENV_STATUS_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
        {status !== "ok" && (
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
        )}
        <div>
          <FieldLabel htmlFor="env-note" hint={`${note.length} / ${MAX_NOTE_LENGTH}`}>
            {status === "ok" ? "Comment (optional)" : "What is the problem?"}
          </FieldLabel>
          <textarea
            id="env-note"
            value={note}
            maxLength={MAX_NOTE_LENGTH}
            onChange={(e) => setNote(e.target.value)}
            rows={5}
            placeholder={status === "ok" ? "e.g. Router rebooted, all channels working again" : "e.g. 27/4: no internet on the box — MCAST live not working, OTT fine"}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-fg transition placeholder:text-fg-subtle hover:border-border-strong focus:border-accent focus:outline-none focus:ring-4 focus:ring-ring"
          />
          {statusChanged && needsNote && <p className="mt-1 text-xs text-fg-muted">Describe the issue so others know what is wrong.</p>}
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
      description="All of these are saved to GitHub together, in one commit. Each change is added to the port's history."
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
                <div className="min-w-0 flex-1 space-y-1">
                  <span className="text-sm font-semibold text-fg">
                    {p.robot} · {p.port}
                  </span>
                  {p.setup !== undefined && (
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                      <Settings2 className="size-3.5" aria-hidden /> Setup: <span className="line-through">{current?.setup || "—"}</span>
                      <ArrowRight className="size-3" aria-hidden /> <span className="font-medium text-fg">{p.setup || "(cleared)"}</span>
                    </p>
                  )}
                  {p.status && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge state={current?.state ?? "none"} />
                      <ArrowRight className="size-3 text-fg-subtle" aria-hidden />
                      <StatusBadge state={p.status} />
                      {issueType(p) && <span className="text-xs text-fg-muted">{issueType(p)}</span>}
                    </div>
                  )}
                  {p.status && p.note && <p className="whitespace-pre-line text-[13px] text-fg">{p.note}</p>}
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

type HistoryRow = { kind: "status"; entry: EnvEntry; current: boolean } | { kind: "setup"; entry: SetupEntry; current: boolean };

function HistoryDialog({ row, onClose }: { row: PortRow | null; onClose: () => void }) {
  const items: HistoryRow[] = row
    ? [
        ...row.entries.map((entry, i): HistoryRow => ({ kind: "status", entry, current: i === row.entries.length - 1 })),
        ...row.setupEntries.map((entry, i): HistoryRow => ({ kind: "setup", entry, current: i === row.setupEntries.length - 1 })),
      ].sort((a, b) => b.entry.at.localeCompare(a.entry.at))
    : [];
  return (
    <Dialog
      open={Boolean(row)}
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title={row ? `History · ${row.robot} · ${row.port}` : "History"}
      description={row ? `${items.length} change${items.length === 1 ? "" : "s"}, newest first.` : undefined}
    >
      <ol className="relative space-y-4 border-l border-border pl-5">
        {items.map((item, i) => (
          <li key={`${item.kind}-${item.entry.at}-${i}`} className="relative">
            <span
              className={cn(
                "absolute -left-[26px] top-1.5 size-2.5 rounded-full ring-4 ring-surface",
                item.kind === "status" ? STATE_STYLE[item.entry.status].dot : "bg-accent",
              )}
              aria-hidden
            />
            <div className="flex flex-wrap items-center gap-2">
              {item.kind === "status" ? (
                <>
                  <StatusBadge state={item.entry.status} />
                  {issueType(item.entry) && <span className="text-xs font-medium text-fg-muted">{issueType(item.entry)}</span>}
                  {item.current && <Badge tone="accent">Current</Badge>}
                </>
              ) : (
                <>
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">
                    <Settings2 className="size-3" aria-hidden /> Setup
                  </span>
                  {item.current && <Badge tone="accent">Current</Badge>}
                </>
              )}
              <span className="ml-auto text-xs text-fg-subtle" title={new Date(item.entry.at).toLocaleString()}>
                {new Date(item.entry.at).toLocaleDateString()} {formatTime(item.entry.at)}
              </span>
            </div>
            {item.entry.by && (
              <p className="mt-1 inline-flex items-center gap-1 text-xs text-fg-muted">
                <UserRound className="size-3.5" aria-hidden /> by <span className="font-semibold text-fg">{item.entry.by}</span>
              </p>
            )}
            {item.entry.note ? (
              <p className="mt-1.5 whitespace-pre-line text-[13px] text-fg">{item.entry.note}</p>
            ) : (
              item.kind === "setup" && <p className="mt-1.5 text-[13px] italic text-fg-muted">Setup cleared</p>
            )}
          </li>
        ))}
      </ol>
    </Dialog>
  );
}
