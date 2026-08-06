/**
 * The tenant-less path, which is the one that has to keep working.
 *
 * No VITE_AZURE_* variables are set under vitest, so this file exercises the
 * build every existing deployment runs: authentication off, no MSAL instance
 * ever constructed, no network call at startup. If any of these break, a laptop
 * or the compose stack has stopped working, which is a louder failure than a
 * misconfigured tenant.
 */

import { describe, expect, it } from "vitest";

import type { AccountInfo } from "@azure/msal-browser";

import {
  getAccessToken,
  identityFrom,
  initAuth,
  isAuthConfigured,
  knownAuthoritiesFor,
} from "./auth";

function account(claims: Record<string, unknown>, username = ""): AccountInfo {
  return {
    homeAccountId: "home",
    environment: "env",
    tenantId: "tenant",
    username,
    localAccountId: "local",
    idTokenClaims: claims,
  } as AccountInfo;
}

describe("without a tenant configured", () => {
  it("reports auth as unconfigured", () => {
    expect(isAuthConfigured()).toBe(false);
  });

  it("bootstraps to nobody without touching the network", async () => {
    await expect(initAuth()).resolves.toEqual({ account: null });
  });

  it("returns no token, so callers send plain unauthenticated requests", async () => {
    await expect(getAccessToken()).resolves.toBeNull();
  });
});

describe("knownAuthoritiesFor", () => {
  it("declares an External ID host, which discovery does not know", () => {
    // Omit this and MSAL rejects the authority outright.
    expect(knownAuthoritiesFor("https://visualizer.ciamlogin.com/tenant-id")).toEqual([
      "visualizer.ciamlogin.com",
    ]);
  });

  it("declares nothing for a workforce host, which discovery does know", () => {
    // The fallback path for an account that cannot create an external tenant.
    // Listing this host would opt out of the alias resolution discovery does.
    expect(knownAuthoritiesFor("https://login.microsoftonline.com/tenant-id")).toEqual([]);
    expect(knownAuthoritiesFor("https://LOGIN.MICROSOFTONLINE.COM/tenant-id")).toEqual([]);
  });
});

describe("identityFrom", () => {
  it("prefers the explicit name and email claims", () => {
    expect(identityFrom(account({ name: "Ada Lovelace", email: "ada@x.dev" }))).toEqual({
      name: "Ada Lovelace",
      email: "ada@x.dev",
    });
  });

  it("falls back through the other spellings External ID uses", () => {
    // A federated sign-up often has no `email` claim at all, so an account that
    // is perfectly valid would otherwise come through with a blank address.
    expect(identityFrom(account({ emails: ["a@x.dev"] })).email).toBe("a@x.dev");
    expect(identityFrom(account({ preferred_username: "b@x.dev" })).email).toBe("b@x.dev");
    expect(identityFrom(account({}, "c@x.dev")).email).toBe("c@x.dev");
  });

  it("survives a token carrying no usable claims at all", () => {
    expect(identityFrom(account({}))).toEqual({ name: "", email: "" });
  });
});
