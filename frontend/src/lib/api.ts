/**
 * Backend client.
 *
 * Talks to same-origin `/api/*`, which Vite proxies in dev. Spring Boot will
 * own this path in production; the tracer's response IS the trace document, so
 * inserting the orchestrator in front changes nothing here.
 */

import type { TraceDocument } from "../types/trace";

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
  const res = await fetch("/api/narrate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(doc),
  });
  if (!res.ok) throw new ApiError(`Narration unavailable (${res.status}).`);
  const body = (await res.json()) as NarrationResponse;
  return body.notes ?? {};
}

export async function runSnippet(req: RunRequest): Promise<TraceDocument> {
  let response: Response;
  try {
    response = await fetch("/api/trace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
  } catch {
    throw new ApiError("Could not reach the server. Is the backend running?");
  }

  if (response.status === 429) {
    throw new ApiError("Too many runs — give it a moment and try again.");
  }
  if (!response.ok) {
    throw new ApiError(`Server error (${response.status}). Try again.`);
  }

  const doc = (await response.json()) as TraceDocument;
  if (doc?.version !== 1 || !Array.isArray(doc.steps)) {
    throw new ApiError("Server returned a trace this build does not understand.");
  }
  return doc;
}
