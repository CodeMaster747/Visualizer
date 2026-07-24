/**
 * What the snippet workspace is currently editing.
 *
 * Lives outside the route component so leaving for Settings and coming back
 * does not silently reset the editor to an example while the loaded trace --
 * which lives in the playback store -- still describes the code you wrote.
 * Those two must always agree, so they have the same lifetime.
 */

import { create } from "zustand";

import { EXAMPLES } from "../lib/examples";
import { usePrefs, type Language } from "./prefs";
import type { SampleFile } from "../lib/api";

interface SessionState {
  language: Language;
  /** Which bundled example is selected, or null once the source diverges. */
  exampleId: string | null;
  source: string;
  files: SampleFile[];
  /** Seeded from preferences on the first visit of this page load. */
  initialized: boolean;

  init: () => void;
  pickExample: (id: string) => void;
  setLanguage: (language: Language) => void;
  setSource: (source: string) => void;
  /** Restore a snippet from the recent-runs list. */
  restore: (input: { language: Language; source: string; files: SampleFile[] }) => void;
}

function firstExample(language: Language) {
  const example = EXAMPLES[language][0];
  return {
    language,
    exampleId: example.id,
    source: example.source,
    files: example.files ?? [],
  };
}

export const useSession = create<SessionState>((set, get) => ({
  ...firstExample("python"),
  initialized: false,

  init: () => {
    if (get().initialized) return;
    set({ ...firstExample(usePrefs.getState().defaultLanguage), initialized: true });
  },

  pickExample: (id) => {
    const example = EXAMPLES[get().language].find((e) => e.id === id);
    if (!example) return;
    set({ exampleId: id, source: example.source, files: example.files ?? [] });
  },

  setLanguage: (language) => set({ ...firstExample(language), initialized: true }),

  // Typing over an example detaches from it, so the picker never claims you
  // are looking at "Aliasing" when you are looking at your own code.
  setSource: (source) => {
    const { language, exampleId } = get();
    const example = EXAMPLES[language].find((e) => e.id === exampleId);
    set({ source, exampleId: example && example.source !== source ? null : exampleId });
  },

  restore: ({ language, source, files }) =>
    set({ language, source, files, exampleId: null, initialized: true }),
}));
