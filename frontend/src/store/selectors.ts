/**
 * Memoized derived state.
 *
 * These MUST NOT be consumed as inline zustand selectors -- `usePlayback(s =>
 * s.currentDiff())` builds fresh Sets on every snapshot read, which React
 * treats as a changed value and spins into an infinite render loop.
 *
 * Deriving from the two primitives that actually drive everything (trace,
 * stepIndex) inside useMemo gives stable identities and recomputes exactly
 * once per step.
 */

import { useMemo } from "react";

import { diffSteps, EMPTY_DIFF, type StepDiff } from "../lib/diff";
import { usePlayback } from "./playback";
import type { Step } from "../types/trace";

export function useCurrentStep(): Step | null {
  const trace = usePlayback((s) => s.trace);
  const index = usePlayback((s) => s.stepIndex);
  return useMemo(() => trace?.steps[index] ?? null, [trace, index]);
}

export function useCurrentDiff(): StepDiff {
  const trace = usePlayback((s) => s.trace);
  const index = usePlayback((s) => s.stepIndex);
  return useMemo(() => {
    const step = trace?.steps[index];
    if (!step) return EMPTY_DIFF;
    return diffSteps(index > 0 ? trace!.steps[index - 1] : undefined, step);
  }, [trace, index]);
}

export function useVisibleStdout(): string {
  const trace = usePlayback((s) => s.trace);
  const index = usePlayback((s) => s.stepIndex);
  return useMemo(() => {
    const step = trace?.steps[index];
    if (!trace || !step) return "";
    return trace.stdout.slice(0, step.stdout_len ?? 0);
  }, [trace, index]);
}

export function useAtEnd(): boolean {
  const count = usePlayback((s) => s.trace?.steps.length ?? 0);
  const index = usePlayback((s) => s.stepIndex);
  return count === 0 || index >= count - 1;
}

/**
 * Narration for the current step, falling back to the nearest earlier narrated
 * step. Long traces are narrated at sampled indices, so carrying the last note
 * forward keeps the strip from flickering empty between samples while scrubbing.
 */
export function useCurrentNote(): string | undefined {
  const notes = usePlayback((s) => s.notes);
  const index = usePlayback((s) => s.stepIndex);
  return useMemo(() => {
    if (notes[index]) return notes[index];
    let best: number | undefined;
    for (const key of Object.keys(notes)) {
      const k = Number(key);
      if (k <= index && (best === undefined || k > best)) best = k;
    }
    return best === undefined ? undefined : notes[best];
  }, [notes, index]);
}
