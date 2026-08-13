/**
 * The signed-in user.
 *
 * This store is the one object every account surface reads -- the sidebar, the
 * account menu, the profile page and the route guard. It holds a projection of
 * the access token and nothing more.
 *
 * Nothing here is persisted, and that is the important part. The token in
 * sessionStorage is the only thing entitled to say who is signed in; writing an
 * account into localStorage beside it would let a stale profile outlive its
 * token and render the whole workspace to someone holding nothing, with every
 * API call 401ing behind a UI that looks signed in. `hydrate` rebuilds this
 * store from the token instead, which cannot drift.
 */

import { create } from "zustand";

import { clearSession, currentIdentity, login, register } from "../lib/auth";

export interface Account {
  name: string;
  email: string;
  /** Derived once at sign-in; the avatar should not re-parse a name to render. */
  initials: string;
}

interface AccountState {
  account: Account | null;
  signIn: (input: { email: string; password: string }) => Promise<void>;
  signUp: (input: { name: string; email: string; password: string }) => Promise<void>;
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
 * capitalised: the best name available when someone signs up without giving
 * one. "ada.lovelace@x.dev" -> "Ada Lovelace".
 *
 * The server derives the same name for the same reason, so this is a display
 * fallback for a token that somehow carries no name rather than the only thing
 * standing between an account and a blank corner of the screen.
 */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const words = local.split(/[._\-+]+/).filter(Boolean);
  if (words.length === 0) return "Guest";
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** One shape for both entry points, so the store never holds a half-built account. */
function toAccount(identity: { name: string; email: string }): Account {
  const display = identity.name.trim() || nameFromEmail(identity.email);
  return { name: display, email: identity.email, initials: initialsOf(display) };
}

export const useAccount = create<AccountState>((set) => ({
  account: null,

  // Both of these reject on failure rather than swallowing it: the sign-in
  // screen needs the server's message ("Incorrect email or password.") to put
  // in front of the person who typed it.
  signIn: async ({ email, password }) => {
    set({ account: toAccount(await login({ email, password })) });
  },

  signUp: async ({ name, email, password }) => {
    set({ account: toAccount(await register({ name, email, password })) });
  },

  // Preferences and recent runs survive on purpose: they belong to the browser,
  // not the profile, and silently wiping someone's settings is a surprising
  // thing for a sign-out button to do.
  signOut: () => {
    clearSession();
    set({ account: null });
  },
}));

/**
 * Resolve who is signed in, before the app renders.
 *
 * Synchronous, because it is a read of sessionStorage and a base64 decode --
 * there is no provider to ask and no redirect to complete. The route guard reads
 * `account` synchronously, so doing this after the first render would bounce an
 * already-signed-in user to /login for a frame before yanking them back.
 *
 * A missing or expired token clears the store, which is what makes an expired
 * session fail closed rather than quietly granting a workspace whose every
 * request will be rejected.
 */
export function hydrate(): void {
  const identity = currentIdentity();
  useAccount.setState({ account: identity ? toAccount(identity) : null });
}

/**
 * Called when the API rejects a token mid-session -- an expiry that crossed
 * midnight, or a server whose signing key was replaced.
 *
 * Dropping the account here is what routes the user back to the sign-in screen
 * instead of leaving them clicking Run against a workspace that will refuse
 * every request.
 */
export function sessionRejected(): void {
  clearSession();
  useAccount.setState({ account: null });
}
