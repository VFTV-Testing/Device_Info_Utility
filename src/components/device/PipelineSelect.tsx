import { Workflow } from "lucide-react";
import { useState } from "react";
import { Badge } from "../ui/primitives";

/**
 * PIPELINE — FUTURE PLACEHOLDER ONLY.
 *
 * This component is intentionally isolated: it owns its own (always empty) state,
 * exposes nothing to its parent, and is not used in device/port selection,
 * matching, search, validation, saving, or the JSON file.
 *
 * To implement pipelines later, add options and an `onChange` prop here and wire
 * it into whatever new feature needs it — existing device logic stays untouched.
 */
export const PIPELINE_OPTIONS: readonly string[] = [];

export function PipelineSelect({ id = "pipeline-select" }: { id?: string }) {
  const [value, setValue] = useState("");

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 flex items-center justify-between text-[13px] font-medium text-fg">
        <span>Pipeline</span>
        <Badge tone="neutral">Coming soon</Badge>
      </label>
      <div className="relative">
        <Workflow className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
        <select
          id={id}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-describedby={`${id}-hint`}
          className="h-11 w-full cursor-not-allowed appearance-none rounded-xl border border-dashed border-border-strong bg-surface-2 pl-9 pr-3 text-sm text-fg-subtle shadow-card focus:outline-none focus:ring-4 focus:ring-ring"
        >
          <option value="">Select Pipeline (Coming Soon)</option>
          {PIPELINE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
      <p id={`${id}-hint`} className="sr-only">
        Pipeline selection is not available yet and does not affect device information.
      </p>
    </div>
  );
}
