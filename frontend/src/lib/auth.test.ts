/**
 * Token handling, which is all the frontend does about authentication.
 *
 * The cases here are the ones that decide whether a signed-in user stays signed
 * in: a token that cannot be parsed, one that has expired, and a name with a
 * character above U+007F in it. Each of those, mishandled, ends as a user being
 * told their session expired when it had not.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearSession, currentIdentity, decodeClaims, getAccessToken, login, register } from "./auth";

/** A token is three dot-separated parts; only the middle one is read here. */
function tokenWith(claims: Record<string, unknown>): string {
  const payload = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(claims))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${payload}.signature`;
}

const inAnHour = Math.floor(Date.now() / 1000) + 3600;
const anHourAgo = Math.floor(Date.now() / 1000) - 3600;

function store(token: string) {
  sessionStorage.setItem("viz.token.v1", token);
}

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("decodeClaims", () => {
  it("reads the payload of a well-formed token", () => {
    expect(decodeClaims(tokenWith({ sub: "u1", name: "Ada", exp: inAnHour }))).toMatchObject({
      sub: "u1",
      name: "Ada",
    });
  });

  it("survives a name that is not ASCII", () => {
    // atob yields one byte per character, so a name like this comes back
    // mangled unless the bytes are put through a UTF-8 decode. The account menu
    // renders whatever this returns.
    expect(decodeClaims(tokenWith({ name: "Ada Lovelacé 李", exp: inAnHour }))?.name).toBe(
      "Ada Lovelacé 李",
    );
  });

  it("returns null rather than throwing on anything unparseable", () => {
    expect(decodeClaims("not-a-token")).toBeNull();
    expect(decodeClaims("header.!!!not-base64!!!.sig")).toBeNull();
    expect(decodeClaims("")).toBeNull();
  });
});

describe("getAccessToken", () => {
  it("returns nothing when nobody is signed in", () => {
    expect(getAccessToken()).toBeNull();
  });

  it("returns a live token", () => {
    const token = tokenWith({ sub: "u1", exp: inAnHour });
    store(token);
    expect(getAccessToken()).toBe(token);
  });

  it("drops an expired token instead of sending it", () => {
    store(tokenWith({ sub: "u1", exp: anHourAgo }));

    expect(getAccessToken()).toBeNull();
    // Cleared, not merely withheld: leaving it behind would have every later
    // call re-check the same dead token.
    expect(sessionStorage.getItem("viz.token.v1")).toBeNull();
  });

  it("drops a token with no expiry at all", () => {
    // Not something this server mints, but a token that never expires is the
    // one shape where a bug would go unnoticed indefinitely.
    store(tokenWith({ sub: "u1" }));
    expect(getAccessToken()).toBeNull();
  });
});

describe("currentIdentity", () => {
  it("projects the display claims", () => {
    store(tokenWith({ sub: "u1", name: "Ada Lovelace", email: "ada@x.dev", exp: inAnHour }));
    expect(currentIdentity()).toEqual({ name: "Ada Lovelace", email: "ada@x.dev" });
  });

  it("is nobody once the token has expired", () => {
    store(tokenWith({ sub: "u1", name: "Ada", email: "ada@x.dev", exp: anHourAgo }));
    expect(currentIdentity()).toBeNull();
  });

  it("degrades to blanks rather than throwing on a claimless token", () => {
    store(tokenWith({ exp: inAnHour }));
    expect(currentIdentity()).toEqual({ name: "", email: "" });
  });
});

describe("login and register", () => {
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

  it("stores the token it is given and returns the identity", async () => {
    const token = tokenWith({ sub: "u1", exp: inAnHour });
    respond(200, { token, expiresAt: Date.now() + 3600_000, user: { name: "Ada", email: "a@x.dev" } });

    await expect(login({ email: "a@x.dev", password: "hunter2!!" })).resolves.toEqual({
      name: "Ada",
      email: "a@x.dev",
    });
    expect(getAccessToken()).toBe(token);
  });

  it("surfaces the server's own message on a rejection", async () => {
    // The message the user reads comes from the API, not from a status-code
    // lookup here -- that is what makes "Incorrect email or password." and
    // "That email address already has an account." land on the right screen.
    respond(401, { detail: "Incorrect email or password." });

    await expect(login({ email: "a@x.dev", password: "wrong" })).rejects.toThrow(
      "Incorrect email or password.",
    );
    expect(getAccessToken()).toBeNull();
  });

  it("falls back to a readable message when the body is not a problem detail", async () => {
    // A proxy or a cold start can answer with HTML; the form still needs a
    // sentence to show.
    respond(502, null);
    await expect(register({ name: "Ada", email: "a@x.dev", password: "hunter2!!" })).rejects.toThrow(
      /502/,
    );
  });

  it("reports an unreachable server distinctly from a rejected one", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    await expect(login({ email: "a@x.dev", password: "hunter2!!" })).rejects.toThrow(
      /Could not reach the server/,
    );
  });
});

describe("clearSession", () => {
  it("removes the token", () => {
    store(tokenWith({ sub: "u1", exp: inAnHour }));
    clearSession();
    expect(getAccessToken()).toBeNull();
  });
});
