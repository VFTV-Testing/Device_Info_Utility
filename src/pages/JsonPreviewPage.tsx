import { CheckCircle2, ChevronDown, ChevronUp, Copy, FileJson, Lock, PencilLine, RefreshCw, Search } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { serializeDeviceData } from "../../shared/serialize";
import { DataStateGate } from "../components/common/DataStateGate";
import { Badge, Button, Card, Input, Notice } from "../components/ui/primitives";
import { useDeviceData } from "../context/DeviceDataContext";
import { useDebouncedValue } from "../hooks";
import { cn, formatTime, shortSha } from "../lib/cn";
import { findMatches, segmentLine, tokenizeLine } from "../utils/jsonHighlight";

const tokenClass = { key: "tok-key", string: "tok-string", number: "tok-number", punct: "tok-punct", plain: "" } as const;

const JsonLine = memo(function JsonLine({
  line,
  number,
  query,
  activeMatchInLine,
}: {
  line: string;
  number: number;
  query: string;
  activeMatchInLine: number;
}) {
  const segments = useMemo(() => segmentLine(tokenizeLine(line), findMatches(line, query), query.length), [line, query]);
  return (
    <div id={`json-line-${number}`} className="flex hover:bg-surface-2/60">
      <span aria-hidden className="w-12 shrink-0 select-none pr-4 text-right text-fg-subtle">
        {number}
      </span>
      <span className="whitespace-pre">
        {segments.map((s, i) =>
          s.match >= 0 ? (
            <mark
              key={i}
              className={cn("rounded-sm text-fg", s.match === activeMatchInLine ? "bg-warning/60 ring-1 ring-warning" : "bg-warning/25", tokenClass[s.kind])}
            >
              {s.text}
            </mark>
          ) : (
            <span key={i} className={tokenClass[s.kind]}>
              {s.text}
            </span>
          ),
        )}
      </span>
    </div>
  );
});

export function JsonPreviewPage() {
  const { snapshot, refresh, syncing, hasUnsavedChanges, connection, config } = useDeviceData();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const search = useDebouncedValue(query, 150);
  const containerRef = useRef<HTMLDivElement>(null);

  const json = useMemo(() => (snapshot ? serializeDeviceData(snapshot.data) : ""), [snapshot]);
  const lines = useMemo(() => json.replace(/\n$/, "").split("\n"), [json]);
  const recordCount = snapshot ? Object.keys(snapshot.data).length : 0;

  /** Flattened list of all matches: [lineIndex, matchIndexInLine]. */
  const matches = useMemo(() => {
    if (!search) return [] as Array<[number, number]>;
    const all: Array<[number, number]> = [];
    lines.forEach((line, li) => findMatches(line, search).forEach((_, mi) => all.push([li, mi])));
    return all;
  }, [lines, search]);

  useEffect(() => setActive(0), [search]);

  const current = matches[Math.min(active, matches.length - 1)];
  useEffect(() => {
    if (!current) return;
    document.getElementById(`json-line-${current[0] + 1}`)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [current]);

  const step = (delta: number) => matches.length && setActive((a) => (a + delta + matches.length) % matches.length);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      toast.success("JSON copied to clipboard");
    } catch {
      toast.error("Copy failed — your browser blocked clipboard access");
    }
  };

  const local = config?.storage === "local";
  const inSync = connection === "connected" && !syncing;

  return (
    <DataStateGate>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">JSON Preview</h2>
            <p className="mt-1 text-sm text-fg-muted">Read-only view of the current deviceInformation.json.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void refresh()} loading={syncing} icon={<RefreshCw className="size-4" />}>
              Refresh
            </Button>
            <Button variant="primary" onClick={() => void copy()} icon={<Copy className="size-4" />}>
              Copy JSON
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {inSync ? (
            <Badge tone="success">
              <CheckCircle2 className="size-3" /> {local ? "Matches the local file" : "Synchronised with GitHub"}
            </Badge>
          ) : (
            <Badge tone="warning">{syncing ? "Synchronising…" : "Not confirmed in sync — refresh to check"}</Badge>
          )}
          <Badge>{recordCount} records</Badge>
          {snapshot && <Badge>version {shortSha(snapshot.version)}</Badge>}
          {snapshot && <Badge>fetched {formatTime(snapshot.fetchedAt)}</Badge>}
          <Badge>
            <Lock className="size-3" /> read-only
          </Badge>
        </div>

        {hasUnsavedChanges && (
          <Notice tone="warning" icon={<PencilLine className="size-4" />} title="You have unsaved edits in Device Manager">
            They are not included here. This preview shows only what is saved {local ? "in the file" : "in GitHub"}.
          </Notice>
        )}

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <div className="relative min-w-0 flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    step(e.shiftKey ? -1 : 1);
                  }
                }}
                placeholder="Search in JSON…"
                aria-label="Search in JSON"
                className="h-9 pl-9"
              />
            </div>
            {search && (
              <div className="flex items-center gap-1 text-xs text-fg-muted">
                <span aria-live="polite">{matches.length ? `${Math.min(active, matches.length - 1) + 1} / ${matches.length}` : "No matches"}</span>
                <Button size="icon" variant="ghost" aria-label="Previous match" disabled={!matches.length} onClick={() => step(-1)}>
                  <ChevronUp className="size-4" />
                </Button>
                <Button size="icon" variant="ghost" aria-label="Next match" disabled={!matches.length} onClick={() => step(1)}>
                  <ChevronDown className="size-4" />
                </Button>
              </div>
            )}
            <span className="ml-auto hidden items-center gap-1 text-xs text-fg-subtle sm:inline-flex">
              <FileJson className="size-3.5" /> {lines.length} lines
            </span>
          </div>
          <div
            ref={containerRef}
            tabIndex={0}
            aria-label="deviceInformation.json content"
            className="max-h-[65vh] overflow-auto bg-surface py-3 font-mono text-[12.5px] leading-relaxed focus:outline-none"
          >
            {lines.map((line, i) => (
              <JsonLine key={i} line={line} number={i + 1} query={search} activeMatchInLine={current && current[0] === i ? current[1] : -1} />
            ))}
          </div>
        </Card>
      </div>
    </DataStateGate>
  );
}
