/**
 * Recently traced snippets, for the home page.
 *
 * Stores the SOURCE, never the trace: a five-thousand-step document with its
 * heap snapshots would blow past the localStorage quota on the first run.
 * Reopening a recent restores the editor; the user presses Visualize again,
 * which is also what keeps this honest when the tracer has changed underneath.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { safeStorage } from "../lib/storage";
import type { SampleFile } from "../lib/api";
import type { Language } from "./prefs";

export interface RecentRun {
  id: string;
  /** First meaningful line of the snippet -- enough to recognise it. */
  title: string;
  language: Language;
  source: string;
  files: SampleFile[];
  status: string;
  steps: number;
  /** Epoch millis. */
  at: number;
}

const LIMIT = 8;

interface RecentsState {
  runs: RecentRun[];
  record: (run: Omit<RecentRun, "id" | "at">) => void;
  clear: () => void;
}

export const useRecents = create<RecentsState>()(
  persist(
    (set) => ({
      runs: [],
      record: (run) =>
        set((s) => ({
          // Re-running the same snippet moves it to the top instead of stacking
          // eight identical rows.
          runs: [
            { ...run, id: crypto.randomUUID(), at: Date.now() },
            ...s.runs.filter((r) => r.source !== run.source || r.language !== run.language),
          ].slice(0, LIMIT),
        })),
      clear: () => set({ runs: [] }),
    }),
    { name: "viz.recents.v1", storage: safeStorage },
  ),
);

/** A snippet's first line of actual code, trimmed to something scannable. */
export function titleFor(source: string): string {
  const line = source
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("//"));
  if (!line) return "Untitled snippet";
  return line.length > 48 ? `${line.slice(0, 47)}…` : line;
}

/** "just now" / "12m ago" / "3h ago" / "yesterday" / "Mar 4". */
export function relativeTime(at: number): string {
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return "yesterday";
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
