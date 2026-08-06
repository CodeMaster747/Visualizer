/**
 * The signed-in user, from whichever of the two identity sources this build has.
 *
 * This store has always been the one object every account surface reads, and it
 * still is -- what changed is where the object comes from. With a Microsoft
 * Entra External ID tenant configured, it is filled from the claims in a real id
 * token and `signIn` hands off to MSAL. Without one, it is the local profile it
 * has always been: no password, no server, no user record anywhere but this
 * browser, and the sign-in screen says so.
 *
 * The old comment here promised that real auth would "replace the body of
 * `signIn` and nothing else", and that turned out to be almost right. The one
 * thing it missed is persistence, which is the subtle half of this file --
 * see `hydrate` below.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  identityFrom,
  initAuth,
  isAuthConfigured,
  signInWithAzure,
  signOutFromAzure,
} from "../lib/auth";
import { safeStorage } from "../lib/storage";

export interface Account {
  name: string;
  email: string;
  /** Derived once at sign-in; the avatar should not re-parse a name to render. */
  initials: string;
}

interface AccountState {
  account: Account | null;
  /**
   * Local-profile sign-in. Only reachable when no tenant is configured; the
   * sign-in screen renders a "Continue with Microsoft" button instead otherwise.
   */
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
      signOut: () => {
        set({ account: null });
        // Clearing locally is not signing out of the identity provider: leave
        // the tenant session alive and the next sign-in silently walks straight
        // back in, which is not what the button appeared to do.
        if (isAuthConfigured()) void signOutFromAzure();
      },
    }),
    {
      name: "viz.account.v1",
      storage: safeStorage,
      // With a tenant configured the token cache is the only thing entitled to
      // say who is signed in, so nothing is written here at all. Persisting an
      // account alongside it would mean a stale entry could outlive its token
      // and render the whole workspace to someone holding nothing -- every API
      // call 401ing behind a UI that looks signed in.
      partialize: (state) => (isAuthConfigured() ? {} : { account: state.account }),
    },
  ),
);

/** Start the Entra sign-in redirect, remembering where the user was headed. */
export function beginAzureSignIn(returnTo?: string): void {
  void signInWithAzure(returnTo);
}

/**
 * Resolve who is signed in, once, before the app renders.
 *
 * With a tenant configured this is authoritative in both directions: an account
 * from MSAL is adopted, and *no* account clears the store. That second half is
 * the point -- it is what makes a stale persisted profile from an earlier build
 * (or an expired session) fail closed rather than quietly granting access to a
 * workspace whose every request will be rejected.
 *
 * Without a tenant it does nothing, leaving the rehydrated local profile alone.
 */
export async function hydrate(): Promise<{ returnTo?: string }> {
  if (!isAuthConfigured()) return {};

  const { account, returnTo } = await initAuth();
  if (!account) {
    useAccount.setState({ account: null });
    return {};
  }

  const { name, email } = identityFrom(account);
  const display = name.trim() || nameFromEmail(email);
  useAccount.setState({
    account: { name: display, email, initials: initialsOf(display) },
  });
  return { returnTo };
}
