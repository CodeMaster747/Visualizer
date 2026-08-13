/**
 * The account store, and the one invariant that matters: the store agrees with
 * the token, always. A profile that outlives its token is a workspace rendered
 * to someone whose every request will be refused.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { hydrate, initialsOf, nameFromEmail, sessionRejected, useAccount } from "./account";

function tokenWith(claims: Record<string, unknown>): string {
  const payload = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(claims))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${payload}.signature`;
}

const inAnHour = Math.floor(Date.now() / 1000) + 3600;
const anHourAgo = Math.floor(Date.now() / 1000) - 3600;

function respond(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
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

describe("signing in", () => {
  it("adopts the identity the server returns", async () => {
    respond(200, {
      token: tokenWith({ sub: "u1", exp: inAnHour }),
      user: { name: "Ada Lovelace", email: "ada@x.dev" },
    });

    await useAccount.getState().signIn({ email: "ada@x.dev", password: "hunter2!!" });

    expect(useAccount.getState().account).toEqual({
      name: "Ada Lovelace",
      email: "ada@x.dev",
      initials: "AL",
    });
  });

  it("derives a display name when the account has none", async () => {
    respond(200, {
      token: tokenWith({ sub: "u1", exp: inAnHour }),
      user: { name: "", email: "ada.lovelace@x.dev" },
    });

    await useAccount.getState().signUp({ name: "", email: "ada.lovelace@x.dev", password: "hunter2!!" });

    expect(useAccount.getState().account?.name).toBe("Ada Lovelace");
  });

  it("rejects without signing anyone in, so the form can show why", async () => {
    respond(401, { detail: "Incorrect email or password." });

    await expect(
      useAccount.getState().signIn({ email: "ada@x.dev", password: "nope" }),
    ).rejects.toThrow("Incorrect email or password.");
    expect(useAccount.getState().account).toBeNull();
  });

  it("signing out ends the session and clears the token", async () => {
    respond(200, {
      token: tokenWith({ sub: "u1", exp: inAnHour }),
      user: { name: "Ada", email: "ada@x.dev" },
    });
    await useAccount.getState().signIn({ email: "ada@x.dev", password: "hunter2!!" });

    useAccount.getState().signOut();

    expect(useAccount.getState().account).toBeNull();
    expect(sessionStorage.getItem("viz.token.v1")).toBeNull();
  });
});

describe("hydrate", () => {
  it("restores the account from a live token", () => {
    sessionStorage.setItem(
      "viz.token.v1",
      tokenWith({ sub: "u1", name: "Ada Lovelace", email: "ada@x.dev", exp: inAnHour }),
    );

    hydrate();

    expect(useAccount.getState().account?.email).toBe("ada@x.dev");
  });

  it("fails closed on an expired token", () => {
    // The case that must not render a workspace: a token from yesterday. Every
    // API call it could make would 401.
    sessionStorage.setItem("viz.token.v1", tokenWith({ sub: "u1", exp: anHourAgo }));

    hydrate();

    expect(useAccount.getState().account).toBeNull();
  });

  it("is nobody when there is no token", () => {
    hydrate();
    expect(useAccount.getState().account).toBeNull();
  });
});

describe("sessionRejected", () => {
  it("signs the user out when the API stops accepting the token", async () => {
    respond(200, {
      token: tokenWith({ sub: "u1", exp: inAnHour }),
      user: { name: "Ada", email: "ada@x.dev" },
    });
    await useAccount.getState().signIn({ email: "ada@x.dev", password: "hunter2!!" });

    // What lib/api.ts calls on a 401 -- the server's key was rotated, say. The
    // route guard reads this and moves them to the sign-in screen, which is the
    // only place re-entering a password can help.
    sessionRejected();

    expect(useAccount.getState().account).toBeNull();
    expect(sessionStorage.getItem("viz.token.v1")).toBeNull();
  });
});
