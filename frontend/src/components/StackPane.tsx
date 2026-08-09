/**
 * Call stack. Innermost frame on top -- the reverse of the trace array order,
 * because "what am I executing right now" should be the first thing read.
 */

import { AnimatePresence, motion } from "framer-motion";

import { ValueChip } from "./ValueChip";
import { orderedLocals } from "../types/trace";
import { usePlayback } from "../store/playback";
import { useCurrentDiff, useCurrentStep } from "../store/selectors";

export function StackPane() {
  const step = useCurrentStep();
  const diff = useCurrentDiff();
  const followVar = usePlayback((s) => s.followVar);
  const setFollowVar = usePlayback((s) => s.setFollowVar);

  if (!step) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-faint">
        No frames
      </div>
    );
  }

  const frames = [...step.frames].reverse();

  return (
    <div className="h-full overflow-auto p-4">
      <AnimatePresence mode="popLayout" initial={false}>
        {frames.map((frame, idx) => {
          const isActive = idx === 0;
          const isNew = diff.pushedFrames.has(frame.id);
          const locals = orderedLocals(frame);

          return (
            <motion.div
              key={frame.id}
              layout
              layoutId={`frame-${frame.id}`}
              initial={isNew ? { opacity: 0, x: 24, scale: 0.96 } : false}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 340, damping: 32 }}
              className={`mb-3 overflow-hidden rounded-lg border bg-surface last:mb-0 ${
                isActive ? "border-accent/50" : "border-border"
              }`}
            >
              <div
                className={`flex h-8 items-center justify-between gap-2 px-3 ${
                  isActive ? "bg-accent-soft" : "bg-surface-2"
                }`}
              >
                <span className="truncate font-mono text-xs font-medium text-ink">
                  {frame.is_global ? "global" : `${frame.name}()`}
                </span>
                <span className="tnum shrink-0 font-mono text-2xs text-ink-faint">
                  line {frame.line}
                </span>
              </div>

              {locals.length === 0 ? (
                <div className="px-3 py-2 text-xs italic text-ink-faint">
                  no variables yet
                </div>
              ) : (
                <table className="w-full border-collapse">
                  <tbody>
                    {locals.map(([name, value]) => {
                      const key = `${frame.id}.${name}`;
                      const changed = diff.changedVars.has(key);
                      const fresh = diff.newVars.has(key);
                      const followed = followVar === name;
                      return (
                        <tr
                          key={name}
                          onClick={() => setFollowVar(followed ? null : name)}
                          className={`cursor-pointer border-t border-border-soft transition-colors
                                      duration-150 hover:bg-surface-2 active:bg-surface-3
                                      ${followed ? "bg-surface-2" : ""}`}
                          title="Click to follow this variable"
                        >
                          <td className="w-px py-1.5 pl-3 pr-4">
                            <span
                              className={`whitespace-nowrap font-mono text-xs ${
                                followed ? "text-accent" : "text-ink-dim"
                              }`}
                            >
                              {followed && "◆ "}
                              {name}
                            </span>
                          </td>
                          <td className="py-1.5 pr-3 text-right">
                            <ValueChip
                              value={value}
                              heap={step.heap}
                              changed={changed}
                              isNew={fresh}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {isActive && step.event === "return" && step.returned && (
                <div className="flex h-8 items-center justify-between gap-2 border-t border-border-soft
                                bg-fresh-soft px-3">
                  <span className="font-mono text-xs text-fresh">returns</span>
                  <ValueChip value={step.returned} heap={step.heap} changed />
                </div>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
