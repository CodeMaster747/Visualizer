/**
 * The signed-in user.
 *
 * There is still no auth service behind this build -- no password, no server,
 * no user record anywhere but this browser. What this store adds is a real
 * session *boundary*: the workspace is gated on having an account, signing out
 * genuinely ends it, and every account surface reads this one object. So the
 * screens are honest about what they are (a local profile) rather than
 * dressing up a fake remote session, and when real auth arrives it replaces
 * the body of `signIn` and nothing else.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { safeStorage } from "../lib/storage";

export interface Account {
  name: string;
  email: string;
  /** Derived once at sign-in; the avatar should not re-parse a name to render. */
  initials: string;
}

interface AccountState {
  account: Account | null;
  signIn: (input: { name?: string; email: string }) => void;
  signOut: () => void;
}

/** "Ada Lovelace" -> "AL", "ada" -> "A". Two letters at most: three is a logo. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]!.charAt(0);
  const last = words.length > 1 ? words[words.length - 1]!.charAt(0) : "";
  return (first + last).toUpperCase();
}

/**
 * The local part of an address, punctuation turned back into spaces and
 * capitalised: the best name available when someone signs in without giving
 * one. "ada.lovelace@x.dev" -> "Ada Lovelace".
 */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const words = local.split(/[._\-+]+/).filter(Boolean);
  if (words.length === 0) return "Guest";
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export const useAccount = create<AccountState>()(
  persist(
    (set) => ({
      account: null,

      signIn: ({ name, email }) => {
        const address = email.trim();
        const display = name?.trim() || nameFromEmail(address);
        set({
          account: { name: display, email: address, initials: initialsOf(display) },
        });
      },

      // Preferences and recent runs survive on purpose: they belong to the
      // browser, not the profile, and silently wiping someone's settings is a
      // surprising thing for a sign-out button to do.
      signOut: () => set({ account: null }),
    }),
    { name: "viz.account.v1", storage: safeStorage },
  ),
);
