/**
 * Accounts, against this app's own API.
 *
 * Everything the frontend knows about authentication lives in this file: two
 * endpoints, one token, and the claims inside it. No identity provider, no SDK,
 * and -- the part that matters most -- no build-time configuration. An earlier
 * version of this file wrapped MSAL and read three `VITE_AZURE_*` variables that
 * Vite inlined at compile time, which meant the browser and the API were
 * configured separately and could disagree: build the bundle without them while
 * the API required a token and you got a sign-in screen that worked followed by
 * a 401 on every request, with no way for the user to recover by signing in
 * again. There is nothing to configure here now, so there is nothing to get out
 * of step.
 *
 * @see store/account.ts, which owns "who is signed in".
 */

/**
 * The token lives in sessionStorage, so closing the tab ends the session.
 *
 * localStorage would keep people signed in across days, and on a shared machine
 * that leaves a working credential behind for whoever sits down next. This app
 * is not worth that trade. The tab-scoped copy is also the single source of
 * truth for who is signed in -- nothing about the account is persisted anywhere
 * else, which is what stops a stale profile from outliving the token that
 * justified it.
 */
const TOKEN_KEY = "viz.token.v1";

export interface Identity {
  name: string;
  email: string;
}

/** The claims this app puts in a token. Anything else in there is ignored. */
interface TokenClaims {
  sub?: string;
  name?: string;
  email?: string;
  exp?: number;
}

export class AuthError extends Error {}

/**
 * Read a JWT's payload without verifying it.
 *
 * Safe, and worth being explicit about why: the signature is checked by the API
 * on every request, and nothing here grants access. These claims decide what
 * name to draw in the corner and whether to bother sending a token that has
 * already expired. A forged token gets someone a wrong name in their own
 * browser and a 401 from the server.
 */
export function decodeClaims(token: string): TokenClaims | null {
  const payload = token.split(".")[1];
  if (!payload) return null;

  try {
    // JWTs use base64url and drop the padding, neither of which atob accepts.
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    // Round-trip through percent-encoding so a non-ASCII name survives; atob
    // alone yields one byte per character and mangles anything above U+007F.
    const json = decodeURIComponent(
      Array.from(atob(padded), (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""),
    );
    return JSON.parse(json) as TokenClaims;
  } catch {
    return null;
  }
}

/** Expiry is in seconds; a token without one is treated as unusable. */
function isExpired(claims: TokenClaims): boolean {
  return typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now();
}

function readStorage(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    // Storage denied (Safari private mode, a hardened profile). Sign-in still
    // works for the life of the page; it just will not survive a reload.
    return null;
  }
}

function writeStorage(token: string | null): void {
  try {
    if (token === null) sessionStorage.removeItem(TOKEN_KEY);
    else sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* see readStorage */
  }
}

/**
 * The token to send, or null.
 *
 * Expired tokens are dropped here rather than sent, which turns "your session
 * expired" into something the app knows before it asks the server. Synchronous
 * on purpose: there is no silent-refresh round trip to await, so callers do not
 * have to be async to attach a credential.
 */
export function getAccessToken(): string | null {
  const token = readStorage();
  if (!token) return null;

  const claims = decodeClaims(token);
  if (!claims || isExpired(claims)) {
    writeStorage(null);
    return null;
  }
  return token;
}

/** Who the stored token says is signed in, or null if there is no live one. */
export function currentIdentity(): Identity | null {
  const token = getAccessToken();
  if (!token) return null;

  const claims = decodeClaims(token);
  if (!claims) return null;

  return { name: claims.name ?? "", email: claims.email ?? "" };
}

/** Drop the local session. The server is stateless, so there is nothing to tell. */
export function clearSession(): void {
  writeStorage(null);
}

interface AuthResponseBody {
  token?: string;
  user?: Identity;
}

/**
 * POST to an auth endpoint and turn whatever comes back into an identity or a
 * thrown `AuthError` carrying a message worth showing.
 *
 * The API answers failures as RFC 9457 problem details, so `detail` is the
 * server's own sentence ("Incorrect email or password.", "That email address
 * already has an account.") and is far better than anything derivable from the
 * status code alone. Falling back to a status-based message matters anyway: a
 * proxy or a cold start can produce a non-JSON body.
 */
async function submit(path: string, body: unknown): Promise<Identity> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError("Could not reach the server. Is the backend running?");
  }

  const payload = (await response.json().catch(() => null)) as
    | (AuthResponseBody & { detail?: string })
    | null;

  if (!response.ok) {
    throw new AuthError(payload?.detail?.trim() || failureFor(response.status));
  }

  if (!payload?.token || !payload.user) {
    throw new AuthError("The server returned an unexpected response.");
  }

  writeStorage(payload.token);
  return payload.user;
}

function failureFor(status: number): string {
  if (status === 429) return "Too many attempts. Wait a moment and try again.";
  if (status === 503) return "The server is starting up. Try again in a moment.";
  return `Something went wrong (${status}). Try again.`;
}

export function register(input: {
  name: string;
  email: string;
  password: string;
}): Promise<Identity> {
  return submit("/api/auth/register", input);
}

export function login(input: { email: string; password: string }): Promise<Identity> {
  return submit("/api/auth/login", input);
}
