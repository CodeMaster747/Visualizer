/**
 * Persistence for the two local stores.
 *
 * Falls back to memory when the browser denies localStorage -- Safari private
 * mode, blocked cookies, a hardened corporate profile. Preferences and recent
 * runs are conveniences; failing to save one must never take the app down with
 * it, which is what an unguarded `localStorage.setItem` does.
 */

import { createJSONStorage, type StateStorage } from "zustand/middleware";

const memory = new Map<string, string>();

const fallback: StateStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => void memory.set(key, value),
  removeItem: (key) => void memory.delete(key),
};

/** Probed once, on first read, because availability cannot be feature-detected
 *  without actually writing. */
export const safeStorage = createJSONStorage(() => {
  try {
    if (typeof localStorage !== "undefined") {
      const probe = "__viz_probe__";
      localStorage.setItem(probe, "1");
      localStorage.removeItem(probe);
      return localStorage;
    }
  } catch {
    /* denied -- use memory */
  }
  return fallback;
});
