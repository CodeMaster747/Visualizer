/**
 * Playback state.
 *
 * The whole UI is a pure function of (trace, stepIndex). Nothing here touches
 * the network or the DOM -- that is what makes scrubbing instant and the
 * reducers unit-testable. The playback timer is the one piece of imperative
 * state, and it lives here rather than in a component so it survives re-renders.
 */

import { create } from "zustand";

import { changePointsFor } from "../lib/diff";
import type { TraceDocument } from "../types/trace";

export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

/** Base delay between steps at 1x. Slow enough to follow, fast enough not to drag. */
const BASE_INTERVAL_MS = 700;

interface PlaybackState {
  trace: TraceDocument | null;
  stepIndex: number;
  playing: boolean;
  speed: Speed;
  /** Variable name pinned for "jump to next change". */
  followVar: string | null;
  /** Object the user is hovering, highlighted across every pane at once. */
  hoveredObject: string | null;
  /** LLM narration, step index -> sentence. Filled in after the trace loads. */
  notes: Record<number, string>;

  loadTrace: (trace: TraceDocument) => void;
  clearTrace: () => void;
  setNotes: (notes: Record<number, string>) => void;

  goTo: (index: number) => void;
  stepForward: () => void;
  stepBack: () => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  setSpeed: (speed: Speed) => void;

  setFollowVar: (name: string | null) => void;
  jumpToNextChange: () => void;
  jumpToPrevChange: () => void;
  setHoveredObject: (id: string | null) => void;

  /**
   * Cheap scalar selector, safe to call inline.
   *
   * Derived state that builds OBJECTS (current step, diffs, sliced stdout)
   * deliberately does not live here: a selector returning a fresh object on
   * every snapshot read makes React think the store changed every render and
   * loops forever. Those live in store/selectors.ts behind useMemo.
   */
  stepCount: () => number;
}

let timer: ReturnType<typeof setInterval> | null = null;

function stopTimer() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

export const usePlayback = create<PlaybackState>((set, get) => {
  function startTimer() {
    stopTimer();
    const delay = BASE_INTERVAL_MS / get().speed;
    timer = setInterval(() => {
      const { stepIndex, stepCount } = get();
      if (stepIndex >= stepCount() - 1) {
        // Stop at the end rather than looping; auto-restart makes it very hard
        // to tell that execution actually finished.
        stopTimer();
        set({ playing: false });
        return;
      }
      set({ stepIndex: stepIndex + 1 });
    }, delay);
  }

  return {
    trace: null,
    stepIndex: 0,
    playing: false,
    speed: 1,
    followVar: null,
    hoveredObject: null,
    notes: {},

    loadTrace: (trace) => {
      stopTimer();
      // Seed notes from any narration the trace already carries (step.note),
      // so a cached, pre-narrated trace shows its notes without a second call.
      const seeded: Record<number, string> = {};
      trace.steps.forEach((s, i) => {
        if (s.note) seeded[i] = s.note;
      });
      set({
        trace, stepIndex: 0, playing: false, followVar: null,
        hoveredObject: null, notes: seeded,
      });
    },

    clearTrace: () => {
      stopTimer();
      set({ trace: null, stepIndex: 0, playing: false, notes: {} });
    },

    setNotes: (notes) => set((s) => ({ notes: { ...s.notes, ...notes } })),

    goTo: (index) => {
      const max = get().stepCount() - 1;
      set({ stepIndex: Math.max(0, Math.min(index, max)) });
    },

    stepForward: () => {
      stopTimer();
      const { stepIndex, stepCount } = get();
      set({ playing: false, stepIndex: Math.min(stepIndex + 1, stepCount() - 1) });
    },

    stepBack: () => {
      stopTimer();
      set((s) => ({ playing: false, stepIndex: Math.max(s.stepIndex - 1, 0) }));
    },

    play: () => {
      const { stepIndex, stepCount } = get();
      if (stepCount() === 0) return;
      // Replaying from the end should restart, not sit there doing nothing.
      if (stepIndex >= stepCount() - 1) set({ stepIndex: 0 });
      set({ playing: true });
      startTimer();
    },

    pause: () => {
      stopTimer();
      set({ playing: false });
    },

    togglePlay: () => (get().playing ? get().pause() : get().play()),

    setSpeed: (speed) => {
      set({ speed });
      if (get().playing) startTimer(); // re-arm at the new cadence
    },

    setFollowVar: (name) => set({ followVar: name }),

    jumpToNextChange: () => {
      const { trace, followVar, stepIndex } = get();
      if (!trace || !followVar) return;
      const next = changePointsFor(trace.steps, followVar).find((i) => i > stepIndex);
      if (next !== undefined) {
        stopTimer();
        set({ stepIndex: next, playing: false });
      }
    },

    jumpToPrevChange: () => {
      const { trace, followVar, stepIndex } = get();
      if (!trace || !followVar) return;
      const prev = [...changePointsFor(trace.steps, followVar)]
        .reverse()
        .find((i) => i < stepIndex);
      if (prev !== undefined) {
        stopTimer();
        set({ stepIndex: prev, playing: false });
      }
    },

    setHoveredObject: (id) => set({ hoveredObject: id }),

    stepCount: () => get().trace?.steps.length ?? 0,
  };
});
