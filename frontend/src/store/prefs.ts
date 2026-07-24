/**
 * User preferences.
 *
 * Local-only and deliberately small: each field is read at exactly one call
 * site, so a preference can never drift away from the behaviour it names.
 * There is no account service behind this -- persistence is the browser.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { safeStorage } from "../lib/storage";
import type { Speed } from "./playback";
// One definition, shared with the trace format: a language the replayer can
// receive is exactly a language the workspace can offer.
import type { Language } from "../types/trace";

export type { Language };

interface PrefsState {
  /** Sidebar rail vs. full width. */
  sidebarCollapsed: boolean;
  /** Mirrors the OS reduced-motion setting for people whose OS says otherwise. */
  reducedMotion: boolean;
  /** Language a fresh snippet session starts in. */
  defaultLanguage: Language;
  /** Playback rate a fresh trace starts at. */
  defaultSpeed: Speed;
  /** Start playing as soon as a trace loads. */
  autoplay: boolean;
  /** Request LLM narration after a run. */
  narration: boolean;

  set: <K extends keyof Omit<PrefsState, "set" | "toggleSidebar">>(
    key: K,
    value: PrefsState[K],
  ) => void;
  toggleSidebar: () => void;
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      reducedMotion: false,
      defaultLanguage: "python",
      defaultSpeed: 1,
      autoplay: false,
      narration: true,

      set: (key, value) => set({ [key]: value } as Partial<PrefsState>),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    { name: "viz.prefs.v1", storage: safeStorage },
  ),
);
