/**
 * The languages the workspace offers, and how to name them.
 *
 * One list, so the toolbar, the settings picker and the recent-runs list can
 * never disagree about whether it is "javascript", "Javascript" or "JS".
 */

import type { Language } from "../types/trace";

export interface LanguageOption {
  value: Language;
  /** Toolbar text. Short, because four segments share the row with a picker. */
  label: string;
  /** Full name, for prose and tooltips. */
  name: string;
}

export const LANGUAGES: LanguageOption[] = [
  { value: "python", label: "Python", name: "Python" },
  { value: "java", label: "Java", name: "Java" },
  { value: "javascript", label: "JS", name: "JavaScript" },
  { value: "typescript", label: "TS", name: "TypeScript" },
];

/** Display name for a language, including ones this build does not offer. */
export function languageName(value: string): string {
  return LANGUAGES.find((l) => l.value === value)?.name ?? value;
}
