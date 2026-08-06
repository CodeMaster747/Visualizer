/**
 * Microsoft Entra External ID, behind a switch.
 *
 * Every Azure-specific thing the frontend knows lives in this file. The rest of
 * the app asks `isAuthConfigured()` and calls four functions; nothing else
 * imports MSAL, and no component branches on which identity provider is in play.
 *
 * The switch matters as much as the integration. Three of this project's four
 * ways to run it -- a laptop, `docker compose up`, and the Render container --
 * have no tenant behind them, and all three must keep working. So when the env
 * vars are absent every function here is a no-op and the app falls back to the
 * local-profile sign-in it has always had. Configuring a tenant is what turns
 * real authentication on, and it is the only thing that does.
 *
 * @see store/account.ts, which owns "who is signed in" either way.
 */

// Types only -- erased at compile time, so importing them costs no bytes and
// does not defeat the code splitting below.
import type {
  PublicClientApplication,
  AccountInfo,
  AuthenticationResult,
} from "@azure/msal-browser";

/**
 * Set all three at build time to enable Azure sign-in. They are Vite env vars,
 * so they are baked into the bundle and therefore public -- which is correct
 * and by design: a SPA client id and authority are not secrets, and the flow
 * below is PKCE precisely so that no secret is needed in the browser.
 */
const CLIENT_ID = import.meta.env.VITE_AZURE_CLIENT_ID as string | undefined;
const AUTHORITY = import.meta.env.VITE_AZURE_AUTHORITY as string | undefined;
const API_SCOPE = import.meta.env.VITE_AZURE_API_SCOPE as string | undefined;

export function isAuthConfigured(): boolean {
  return Boolean(CLIENT_ID && AUTHORITY && API_SCOPE);
}

/**
 * Hosts MSAL already trusts via Microsoft's instance discovery.
 *
 * `knownAuthorities` exists to allowlist authorities that discovery does *not*
 * know about, which is why an External ID tenant on `*.ciamlogin.com` needs it
 * and a workforce tenant on `login.microsoftonline.com` does not. Declaring a
 * discoverable host anyway makes MSAL skip discovery for it, so this is not
 * merely redundant -- it opts out of the alias resolution that discovery would
 * otherwise do. Both tenant types are supported here (see infra/azure/README.md
 * on why a student account may only be able to use the workforce one), so the
 * distinction is made rather than guessed at.
 */
const DISCOVERABLE_HOSTS = [
  "login.microsoftonline.com",
  "login.microsoftonline.us",
  "login.partner.microsoftonline.cn",
];

export function knownAuthoritiesFor(authority: string): string[] {
  const { host } = new URL(authority);
  return DISCOVERABLE_HOSTS.includes(host.toLowerCase()) ? [] : [host];
}

/**
 * The claims we care about, extracted from an id token.
 *
 * External ID populates these differently depending on how the user signed up
 * -- an email sign-up fills `email`, a federated Google account may fill only
 * `preferred_username` -- so all the plausible spellings are tried rather than
 * trusting one.
 */
export interface AzureIdentity {
  name: string;
  email: string;
}

interface IdTokenClaims {
  name?: string;
  email?: string;
  preferred_username?: string;
  emails?: string[];
}

export function identityFrom(account: AccountInfo): AzureIdentity {
  const claims = (account.idTokenClaims ?? {}) as IdTokenClaims;
  const email =
    claims.email ?? claims.emails?.[0] ?? claims.preferred_username ?? account.username ?? "";
  return { name: claims.name ?? account.name ?? "", email };
}

/**
 * MSAL is loaded on demand, not bundled into the main chunk.
 *
 * It is roughly 200 kB of JavaScript, and on a build with no tenant configured
 * not one line of it will ever run. Shipping it to every visitor of a
 * deployment that cannot use it is exactly the kind of cost that is invisible
 * until someone loads the page on a phone. The dynamic import makes Vite split
 * it into its own chunk, fetched only when a sign-in actually needs it.
 */
let msalModule: Promise<typeof import("@azure/msal-browser")> | null = null;

function loadMsal(): Promise<typeof import("@azure/msal-browser")> {
  return (msalModule ??= import("@azure/msal-browser"));
}

let client: PublicClientApplication | null = null;
let initialized: Promise<void> | null = null;

/** The initialised singleton. Safe to call repeatedly; only the first does work. */
async function instance(): Promise<PublicClientApplication> {
  const msal = await loadMsal();
  client ??= new msal.PublicClientApplication({
    auth: {
      clientId: CLIENT_ID!,
      authority: AUTHORITY!,
      // Empty for a workforce tenant, the ciamlogin host for an External ID
      // one. Without it, an External ID authority is rejected as unknown.
      knownAuthorities: knownAuthoritiesFor(AUTHORITY!),
      redirectUri: window.location.origin,
      postLogoutRedirectUri: window.location.origin,
    },
    cache: {
      // Session storage, so closing the tab ends the session. The alternative
      // leaves a token in localStorage on what may well be a shared machine,
      // and this app is not valuable enough to justify that trade.
      cacheLocation: "sessionStorage",
    },
  });
  initialized ??= client.initialize();
  await initialized;
  return client;
}

export interface AuthBootstrap {
  account: AccountInfo | null;
  /**
   * Where the user was going before they were sent to sign in, present only on
   * the load that completes a redirect. A full page navigation destroys router
   * state, so this makes the round trip inside the token request itself.
   */
  returnTo?: string;
}

/**
 * Prepare MSAL and finish any sign-in that is mid-flight.
 *
 * Must be awaited before the app renders. A redirect flow lands back on the app
 * with the authorization code in the URL, and `handleRedirectPromise` is what
 * exchanges it -- render first and the router strips the code out of the URL
 * before MSAL ever sees it, which fails in a way that looks like the identity
 * provider is broken rather than like a load-order bug.
 */
export async function initAuth(): Promise<AuthBootstrap> {
  if (!isAuthConfigured()) return { account: null };

  const msal = await instance();

  let redirect: AuthenticationResult | null = null;
  try {
    redirect = await msal.handleRedirectPromise();
  } catch {
    // A failed or abandoned sign-in leaves the user signed out, which the
    // guard already handles. Better that than a blank page at startup.
    redirect = null;
  }

  const account = redirect?.account ?? msal.getAllAccounts()[0] ?? null;
  if (account) msal.setActiveAccount(account);
  return { account, returnTo: redirect?.state || undefined };
}

/** Begin sign-in. Navigates away, so nothing after this call runs. */
export async function signInWithAzure(returnTo?: string): Promise<void> {
  const msal = await instance();
  await msal.loginRedirect({
    scopes: [API_SCOPE!],
    // Survives the round trip so a deep link is not lost at the front door.
    state: returnTo,
  });
}

export async function signOutFromAzure(): Promise<void> {
  const msal = await instance();
  await msal.logoutRedirect({ account: msal.getActiveAccount() ?? undefined });
}

/**
 * An access token for the backend API, or null when Azure is not configured.
 *
 * Silent first: MSAL serves a cached token and refreshes it behind the scenes,
 * so the common case costs nothing. Only a genuinely expired session --
 * `InteractionRequiredAuthError`, which is MSAL's way of saying the user has to
 * be involved -- escalates to a redirect. Any other failure returns null and
 * lets the caller send an unauthenticated request, because a backend with auth
 * switched off will answer it fine and one with auth on will say 401 clearly.
 */
export async function getAccessToken(): Promise<string | null> {
  if (!isAuthConfigured()) return null;

  const msal = await instance();
  const account = msal.getActiveAccount() ?? msal.getAllAccounts()[0];
  if (!account) return null;

  try {
    const result = await msal.acquireTokenSilent({ scopes: [API_SCOPE!], account });
    return result.accessToken;
  } catch (error) {
    const { InteractionRequiredAuthError } = await loadMsal();
    if (error instanceof InteractionRequiredAuthError) {
      await msal.acquireTokenRedirect({ scopes: [API_SCOPE!], account });
    }
    return null;
  }
}
