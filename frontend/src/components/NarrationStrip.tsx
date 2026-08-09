/**
 * One-line plain-English narration of the current step.
 *
 * Narration is optional and additive: the visualization is fully usable without
 * it, so this strip stays out of the way (and hides entirely) when the LLM has
 * nothing for the current step or is unavailable.
 */

import { AnimatePresence, motion } from "framer-motion";

import { Icon } from "./ui/Icon";
import { usePlayback } from "../store/playback";
import { useCurrentNote } from "../store/selectors";

interface Props {
  loading: boolean;
}

export function NarrationStrip({ loading }: Props) {
  const stepIndex = usePlayback((s) => s.stepIndex);
  const note = useCurrentNote();
  const hasAny = usePlayback((s) => Object.keys(s.notes).length > 0);

  // Nothing to show and nothing coming: take up no space at all.
  if (!note && !loading && !hasAny) return null;

  return (
    <div className="flex min-h-control-md shrink-0 items-center gap-3 border-t border-border-soft
                    bg-surface px-4 py-2">
      {/* The one eyebrow in the app that is not `ink-faint`, which is exactly
          why the utility leaves colour to the call site. */}
      <span className="eyebrow flex shrink-0 items-center gap-1.5 text-accent">
        <Icon name="sparkle" size={12} />
        {loading && !hasAny ? "Explaining…" : "AI"}
      </span>
      <AnimatePresence mode="wait">
        <motion.p
          key={stepIndex}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.18 }}
          className="text-sm leading-normal text-ink-dim"
        >
          {note ?? (
            <span className="italic text-ink-faint">
              {loading ? "Generating explanations…" : "No explanation for this step."}
            </span>
          )}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
