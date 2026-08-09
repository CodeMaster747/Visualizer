/**
 * stdout as of the current step, plus any terminal error.
 *
 * Output is sliced from the cumulative buffer by step, so scrubbing backwards
 * un-prints lines. That reversibility is a big part of why a replayed trace
 * feels more trustworthy than a live console.
 */

import { motion } from "framer-motion";

import { usePlayback } from "../store/playback";
import { useAtEnd, useCurrentStep, useVisibleStdout } from "../store/selectors";

/**
 * A successful run needs no announcement, so "ok" is the quietest thing here.
 * Only the states the reader has to act on are given any weight.
 */
const STATUS_STYLE: Record<string, string> = {
  ok: "text-ink-faint",
  error: "text-danger",
  timeout: "text-ink",
  truncated: "text-ink",
  compile_error: "text-danger",
};

/** Status badge for the Output panel header, rendered by the panel chrome. */
export function OutputStatus() {
  const trace = usePlayback((s) => s.trace);
  if (!trace) return null;
  return (
    <span className={`tnum font-mono text-xs ${STATUS_STYLE[trace.status] ?? "text-ink-faint"}`}>
      {trace.status}
      {trace.meta?.duration_ms !== undefined &&
        ` · ${trace.meta.duration_ms.toFixed(0)}ms`}
    </span>
  );
}

export function OutputPane() {
  const trace = usePlayback((s) => s.trace);
  const stdout = useVisibleStdout();
  const step = useCurrentStep();
  const atEnd = useAtEnd();

  if (!trace) return null;

  const showError = trace.error && atEnd;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto p-4">
        {stdout ? (
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink-dim">
            {stdout}
          </pre>
        ) : (
          <span className="font-mono text-xs italic text-ink-faint">
            (no output yet)
          </span>
        )}

        {step?.figure && (
          <img
            src={`data:image/png;base64,${step.figure}`}
            alt="figure"
            className="mt-3 max-w-full rounded-lg border border-border"
          />
        )}

        {showError && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 rounded-lg border border-danger/40 bg-danger-soft p-3"
          >
            <div className="font-mono text-xs font-semibold text-danger">
              {trace.error!.type}
              {trace.error!.line !== undefined && (
                <span className="ml-1.5 font-normal text-ink-faint">
                  line {trace.error!.line}
                </span>
              )}
            </div>
            <div className="mt-1 font-mono text-xs leading-relaxed text-ink-dim">
              {trace.error!.message}
            </div>
            {trace.error!.traceback && trace.error!.traceback.length > 0 && (
              <div className="mt-2 border-t border-danger/20 pt-2">
                {trace.error!.traceback.map((f, i) => (
                  <div key={i} className="font-mono text-2xs leading-relaxed text-ink-faint">
                    {f.name} · line {f.line}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </div>

      {(trace.status === "truncated" || trace.status === "timeout") && (
        <div className="border-t border-border bg-surface-2 px-4 py-2
                        font-mono text-2xs leading-relaxed text-ink-dim">
          {trace.status === "timeout"
            ? `Execution stopped after ${(trace.limits?.timeout_ms ?? 0) / 1000}s — trace is partial.`
            : `Trace hit the ${trace.limits?.max_steps ?? "step"} limit — showing the first portion.`}
        </div>
      )}
    </div>
  );
}
