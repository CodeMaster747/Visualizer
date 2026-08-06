/**
 * The local-profile store, and the derivations the account surfaces rely on.
 *
 * `hydrate` is covered only in its tenant-less form here, because that is the
 * branch this build actually takes -- see lib/auth.test.ts for why.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { hydrate, initialsOf, nameFromEmail, useAccount } from "./account";

beforeEach(() => {
  useAccount.setState({ account: null });
});

describe("initialsOf", () => {
  it("takes the first and last initial, never a third", () => {
    expect(initialsOf("Ada Lovelace")).toBe("AL");
    expect(initialsOf("Ada Byron King Lovelace")).toBe("AL");
  });

  it("handles a single word and stray whitespace", () => {
    expect(initialsOf("ada")).toBe("A");
    expect(initialsOf("   ada   ")).toBe("A");
  });

  it("degrades rather than throwing on an empty name", () => {
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("   ")).toBe("?");
  });
});

describe("nameFromEmail", () => {
  it("turns punctuation back into a spaced, capitalised name", () => {
    expect(nameFromEmail("ada.lovelace@x.dev")).toBe("Ada Lovelace");
    expect(nameFromEmail("ada_byron-king@x.dev")).toBe("Ada Byron King");
  });

  it("falls back to Guest when the local part is unusable", () => {
    expect(nameFromEmail("@x.dev")).toBe("Guest");
  });
});

describe("local sign-in", () => {
  it("derives a display name from the address when none is given", () => {
    useAccount.getState().signIn({ email: "ada.lovelace@x.dev" });

    expect(useAccount.getState().account).toEqual({
      name: "Ada Lovelace",
      email: "ada.lovelace@x.dev",
      initials: "AL",
    });
  });

  it("prefers an explicitly supplied name", () => {
    useAccount.getState().signIn({ name: "Grace Hopper", email: "ada@x.dev" });

    expect(useAccount.getState().account?.name).toBe("Grace Hopper");
  });

  it("signing out ends the session", () => {
    useAccount.getState().signIn({ email: "ada@x.dev" });
    useAccount.getState().signOut();

    expect(useAccount.getState().account).toBeNull();
  });
});

describe("hydrate without a tenant", () => {
  it("leaves the rehydrated local profile alone", async () => {
    // The tenant-less build must not have its persisted profile cleared by the
    // startup hook -- that would sign everyone out on every page load.
    useAccount.getState().signIn({ email: "ada@x.dev" });

    await expect(hydrate()).resolves.toEqual({});
    expect(useAccount.getState().account?.email).toBe("ada@x.dev");
  });
});
