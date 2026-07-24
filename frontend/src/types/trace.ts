/**
 * TypeScript mirror of schema/trace-v1.schema.json.
 *
 * The replayer consumes ONLY this shape. It must never branch on `language` --
 * if a feature needs to know whether it is rendering Python or Java, the trace
 * format is missing something and the schema should change instead.
 */

export type Language = "python" | "java" | "javascript" | "typescript";

export type TraceStatus =
  | "ok"
  | "error"
  | "timeout"
  | "truncated"
  | "compile_error";

export type StepEvent = "line" | "call" | "return" | "exception";

export type PrimType =
  | "int"
  | "float"
  | "bool"
  | "str"
  | "null"
  | "char"
  | "long"
  | "double";

/**
 * A slot in a frame or container. Exactly one of `prim` / `ref` is set.
 * Primitives inline; everything else points into the heap, which is what makes
 * aliasing (two names, one id) and cycles representable at all.
 */
export interface TraceValue {
  prim?: string | number | boolean | null;
  prim_type?: PrimType;
  ref?: string;
  truncated?: boolean;
}

export interface DictEntry {
  key: TraceValue;
  value: TraceValue;
}

/**
 * `kind` is an open enum on purpose: known kinds get a dedicated renderer,
 * anything else falls back to a generic box driven by `repr`. Adding a rich
 * type must never require touching this file.
 */
export type HeapKind =
  | "list"
  | "tuple"
  | "set"
  | "dict"
  | "deque"
  | "instance"
  | "class"
  | "function"
  | "module"
  | "dataframe"
  | "series"
  | "ndarray"
  | (string & {});

export interface HeapObject {
  kind: HeapKind;
  repr?: string;
  truncated?: boolean;

  // sequences
  items?: TraceValue[];
  total?: number;

  // mappings
  entries?: DictEntry[];

  // instances / classes
  class?: string;
  fields?: Record<string, TraceValue>;
  field_order?: string[];
  methods?: string[];
  mro?: string[];

  // tabular / array
  shape?: number[];
  dtype?: string;
  columns?: string[];
  dtypes?: Record<string, string>;
  index?: (string | number)[];
  preview?: (string | number | boolean | null)[][];

  name?: string;
}

export interface Frame {
  /** Stable per invocation. Recursion yields distinct ids, which is what lets
   *  each frame animate independently instead of morphing into its neighbour. */
  id: string;
  name: string;
  line: number;
  locals: Record<string, TraceValue>;
  /** JSON objects are unordered; without this, variables visibly reshuffle
   *  between steps. Always prefer this over Object.keys(). */
  order?: string[];
  is_global?: boolean;
}

export interface Step {
  i: number;
  line: number;
  event: StepEvent;
  stdout_len?: number;
  /** Innermost frame LAST. Index 0 is the global/main frame. */
  frames: Frame[];
  heap: Record<string, HeapObject>;
  returned?: TraceValue;
  figure?: string;
  note?: string;
}

export interface TraceError {
  type: string;
  message: string;
  line?: number;
  traceback?: { name?: string; line?: number }[];
}

export interface TraceLimits {
  max_steps?: number;
  max_depth?: number;
  max_items?: number;
  max_string?: number;
  timeout_ms?: number;
}

export interface TraceMeta {
  duration_ms?: number;
  step_count?: number;
  runtime_version?: string;
  packages?: string[];
  /** How this language spells null/true/false. See `formatPrim`. */
  literals?: Literals;
  warnings?: string[];
}

export interface Literals {
  null?: string;
  true?: string;
  false?: string;
}

/**
 * Used when a document predates `meta.literals`.
 *
 * Language-neutral on purpose: guessing one language's spelling would be
 * confidently wrong for every other one.
 */
export const DEFAULT_LITERALS: Required<Literals> = {
  null: "null",
  true: "true",
  false: "false",
};

export interface TraceDocument {
  version: 1;
  language: Language;
  status: TraceStatus;
  source?: string;
  steps: Step[];
  stdout: string;
  error?: TraceError;
  limits?: TraceLimits;
  meta?: TraceMeta;
}

// --- helpers ---------------------------------------------------------------

export function isRef(v: TraceValue | undefined): v is TraceValue & { ref: string } {
  return !!v && typeof v.ref === "string";
}

export function isPrim(v: TraceValue | undefined): boolean {
  return !!v && v.ref === undefined;
}

/** Frame locals in declaration order, falling back to insertion order. */
export function orderedLocals(frame: Frame): [string, TraceValue][] {
  const keys = frame.order?.length ? frame.order : Object.keys(frame.locals);
  return keys
    .filter((k) => k in frame.locals)
    .map((k) => [k, frame.locals[k]] as [string, TraceValue]);
}

/** Instance fields in declaration order. */
export function orderedFields(obj: HeapObject): [string, TraceValue][] {
  const fields = obj.fields ?? {};
  const keys = obj.field_order?.length ? obj.field_order : Object.keys(fields);
  return keys
    .filter((k) => k in fields)
    .map((k) => [k, fields[k]] as [string, TraceValue]);
}

/**
 * Render a primitive the way the source language would show it.
 *
 * The spellings come from the document, never from a check on `language`:
 * "None" and "null" are the same value, and only the tracer knows which word
 * the reader is expecting. A tracer can also send its own text for a
 * null-typed value, which is how JavaScript keeps `undefined` distinct
 * from `null`.
 */
export function formatPrim(v: TraceValue, literals: Literals = DEFAULT_LITERALS): string {
  if (v.prim === null || v.prim_type === "null") {
    if (typeof v.prim === "string") return v.prim;
    return literals.null ?? DEFAULT_LITERALS.null;
  }
  if (v.prim_type === "str") return JSON.stringify(v.prim);
  if (v.prim_type === "bool") {
    return v.prim
      ? literals.true ?? DEFAULT_LITERALS.true
      : literals.false ?? DEFAULT_LITERALS.false;
  }
  if (v.prim_type === "float" || v.prim_type === "double") {
    return Number.isInteger(v.prim as number)
      ? `${v.prim}.0`
      : String(v.prim);
  }
  return String(v.prim);
}
