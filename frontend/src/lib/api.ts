/**
 * Backend client.
 *
 * Talks to same-origin `/api/*`, which Vite proxies in dev. Spring Boot owns
 * this path in production; the tracer's response IS the trace document, so
 * inserting the orchestrator in front changes nothing here.
 */

import { getAccessToken } from "./auth";
import { sessionRejected } from "../store/account";
import type { TraceDocument } from "../types/trace";

/**
 * `fetch` with the access token attached, and a single place that notices when
 * the server stops accepting it.
 *
 * Every authenticated endpoint goes through here, so a 401 anywhere signs the
 * user out exactly once and the route guard takes them to the sign-in screen.
 * Without that, an expired token leaves a workspace that looks signed in and
 * refuses every request -- and re-entering a password would be the one thing
 * that could not fix it, because nothing was listening for the answer.
 */
async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const token = getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(url, { ...init, headers });
  if (response.status === 401 || response.status === 403) {
    sessionRejected();
  }
  return response;
}

export interface SampleFile {
  name: string;
  content: string;
}

export interface RunRequest {
  language: string;
  source: string;
  stdin?: string;
  files?: SampleFile[];
  limits?: Record<string, number>;
}

export class ApiError extends Error {}

export interface ServerInfo {
  /** Packages in the sandbox image for each language that has any. */
  packagesByLanguage: Record<string, string[]>;
  packages: string[];
  /** Human phrase for where uploaded files land, e.g. "the current directory". */
  dataHint: string;
  /** Which language tracers are reachable, e.g. { python: true, java: false }. */
  languages: Record<string, boolean>;
}

export async function fetchServerInfo(): Promise<ServerInfo | null> {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) return null;
    const body = await res.json();
    return {
      packagesByLanguage: body.packages_by_language ?? {},
      packages: body.packages ?? [],
      dataHint: body.data_hint ?? "the current directory",
      languages: body.languages ?? { python: true },
    };
  } catch {
    return null; // health is advisory; the app still works without it
  }
}

export interface NarrationResponse {
  /** step index -> one-sentence explanation. Absent keys have no narration. */
  notes: Record<number, string>;
}

/**
 * Fetch LLM narration for an already-run trace. Kept separate from the trace
 * call so the visualization appears immediately and narration streams in after;
 * a slow or absent LLM never blocks the core product.
 */
export async function fetchNarration(doc: TraceDocument): Promise<Record<number, string>> {
  const res = await call("/api/narrate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(doc),
  });
  if (!res.ok) throw new ApiError(`Narration unavailable (${res.status}).`);
  const body = (await res.json()) as NarrationResponse;
  return body.notes ?? {};
}

/**
 * The server's content-addressed id for a trace, returned alongside it.
 *
 * Undefined against an older backend, which is the whole reason it is optional
 * rather than assumed: the caller hides the share affordance instead of
 * producing a link to nothing.
 */
export interface TraceResult {
  doc: TraceDocument;
  id?: string;
}

const TRACE_ID_HEADER = "X-Trace-Id";

/** Shared by both paths, so a stored trace is validated as strictly as a fresh one. */
function parseTrace(body: unknown): TraceDocument {
  const doc = body as TraceDocument;
  if (doc?.version !== 1 || !Array.isArray(doc.steps)) {
    throw new ApiError("Server returned a trace this build does not understand.");
  }
  return doc;
}

function describeFailure(status: number): string {
  if (status === 429) return "Too many runs — give it a moment and try again.";
  // `call` has already cleared the session by the time this runs, so the route
  // guard is about to move the user to the sign-in screen and the advice is
  // something they can actually act on.
  if (status === 401 || status === 403) return "Your session expired. Sign in again to run code.";
  if (status === 503) return "The execution service is starting up. Try again in a moment.";
  return `Server error (${status}). Try again.`;
}

export async function runSnippet(req: RunRequest): Promise<TraceResult> {
  let response: Response;
  try {
    response = await call("/api/trace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
  } catch {
    throw new ApiError("Could not reach the server. Is the backend running?");
  }

  if (!response.ok) {
    throw new ApiError(describeFailure(response.status));
  }

  return {
    doc: parseTrace(await response.json()),
    id: response.headers.get(TRACE_ID_HEADER) ?? undefined,
  };
}

/**
 * Load a previously executed trace by id -- the read side of a shared link.
 *
 * Returns null for a link that does not resolve, which is a normal outcome
 * rather than an error: without a storage account configured the backend only
 * remembers traces until it restarts, so an old link legitimately goes cold.
 * The caller says so and offers the editor.
 */
export async function fetchTraceById(id: string): Promise<TraceDocument | null> {
  let response: Response;
  try {
    response = await call(`/api/trace/${encodeURIComponent(id)}`);
  } catch {
    throw new ApiError("Could not reach the server. Is the backend running?");
  }

  if (response.status === 404) return null;
  if (!response.ok) throw new ApiError(describeFailure(response.status));

  return parseTrace(await response.json());
}
