/**
 * Step-to-step change detection.
 *
 * This is what the animation layer keys off: a variable that changed gets a
 * flash + morph, one that did not stays completely still. Getting this wrong in
 * either direction is very visible -- false positives make the whole panel
 * strobe on every step, false negatives make real updates look like nothing
 * happened.
 *
 * Pure functions over two steps. No React, no store: trivially unit-testable.
 */

import type { HeapObject, Step, TraceValue } from "../types/trace";

export interface StepDiff {
  /** "frameId.varName" for locals whose value changed or that just appeared. */
  changedVars: Set<string>;
  /** Locals that did not exist in the previous step. */
  newVars: Set<string>;
  /** Heap ids whose contents changed. */
  changedObjects: Set<string>;
  /** Heap ids not present in the previous step. */
  newObjects: Set<string>;
  /** Frame ids pushed since the previous step. */
  pushedFrames: Set<string>;
  /** Frame ids popped since the previous step (rendered on their way out). */
  poppedFrames: Set<string>;
}

export const EMPTY_DIFF: StepDiff = {
  changedVars: new Set(),
  newVars: new Set(),
  changedObjects: new Set(),
  newObjects: new Set(),
  pushedFrames: new Set(),
  poppedFrames: new Set(),
};

function sameValue(a: TraceValue | undefined, b: TraceValue | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.ref !== undefined || b.ref !== undefined) return a.ref === b.ref;
  return a.prim === b.prim && a.prim_type === b.prim_type;
}

/**
 * Shallow comparison only. A container whose *element* changed is "changed";
 * a container holding a ref to an object that changed is NOT -- that object
 * reports its own change. This keeps a mutation deep in a linked list from
 * lighting up every node that transitively points at it.
 */
function sameObject(a: HeapObject | undefined, b: HeapObject | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.kind !== b.kind) return false;

  if (a.items || b.items) {
    const x = a.items ?? [];
    const y = b.items ?? [];
    if (x.length !== y.length) return false;
    if (!x.every((v, i) => sameValue(v, y[i]))) return false;
  }

  if (a.entries || b.entries) {
    const x = a.entries ?? [];
    const y = b.entries ?? [];
    if (x.length !== y.length) return false;
    if (!x.every((e, i) => sameValue(e.key, y[i].key) && sameValue(e.value, y[i].value)))
      return false;
  }

  if (a.fields || b.fields) {
    const x = a.fields ?? {};
    const y = b.fields ?? {};
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    for (const k of keys) if (!sameValue(x[k], y[k])) return false;
  }

  // Rich values (DataFrame/ndarray/Series). repr and shape catch structural
  // changes, but `arr *= 10` keeps both identical while every cell changes, so
  // the preview grid has to be compared too or an in-place update looks like
  // nothing happened. The preview is already capped (max_items) so this is
  // bounded work, not an O(rows) walk over the real data.
  if (a.repr !== b.repr) return false;
  if (JSON.stringify(a.shape) !== JSON.stringify(b.shape)) return false;
  if (a.preview || b.preview) {
    if (JSON.stringify(a.preview) !== JSON.stringify(b.preview)) return false;
  }

  return true;
}

export function diffSteps(prev: Step | undefined, curr: Step): StepDiff {
  if (!prev) {
    // First step: everything is new, but nothing should animate as "changed"
    // or the opening frame flashes in its entirety.
    return {
      ...EMPTY_DIFF,
      newVars: new Set(
        curr.frames.flatMap((f) => Object.keys(f.locals).map((k) => `${f.id}.${k}`)),
      ),
      newObjects: new Set(Object.keys(curr.heap)),
      pushedFrames: new Set(curr.frames.map((f) => f.id)),
      changedVars: new Set(),
      changedObjects: new Set(),
      poppedFrames: new Set(),
    };
  }

  const changedVars = new Set<string>();
  const newVars = new Set<string>();
  const prevFrames = new Map(prev.frames.map((f) => [f.id, f]));
  const currFrames = new Map(curr.frames.map((f) => [f.id, f]));

  for (const frame of curr.frames) {
    const before = prevFrames.get(frame.id);
    for (const [name, value] of Object.entries(frame.locals)) {
      const key = `${frame.id}.${name}`;
      if (!before || !(name in before.locals)) {
        newVars.add(key);
      } else if (!sameValue(before.locals[name], value)) {
        changedVars.add(key);
      }
    }
  }

  const changedObjects = new Set<string>();
  const newObjects = new Set<string>();
  for (const [id, obj] of Object.entries(curr.heap)) {
    if (!(id in prev.heap)) newObjects.add(id);
    else if (!sameObject(prev.heap[id], obj)) changedObjects.add(id);
  }

  const pushedFrames = new Set(
    curr.frames.filter((f) => !prevFrames.has(f.id)).map((f) => f.id),
  );
  const poppedFrames = new Set(
    prev.frames.filter((f) => !currFrames.has(f.id)).map((f) => f.id),
  );

  return {
    changedVars,
    newVars,
    changedObjects,
    newObjects,
    pushedFrames,
    poppedFrames,
  };
}

/**
 * Step indices where `varName` in any frame takes a new value.
 * Backs the "jump to next change of x" control -- the fastest way to find the
 * moment a bug happens in a long trace.
 */
export function changePointsFor(steps: Step[], varName: string): number[] {
  const points: number[] = [];
  let last: TraceValue | undefined;
  let seen = false;

  for (const step of steps) {
    // Innermost frame wins, matching what the user is looking at.
    let found: TraceValue | undefined;
    for (let i = step.frames.length - 1; i >= 0; i--) {
      if (varName in step.frames[i].locals) {
        found = step.frames[i].locals[varName];
        break;
      }
    }
    if (found === undefined) continue;
    if (!seen || !sameValue(last, found)) {
      points.push(step.i);
      seen = true;
    }
    last = found;
  }
  return points;
}

/**
 * Heap ids reachable from any frame, so we never lay out orphans the user
 * cannot see. Cycle-safe.
 */
export function reachableObjects(step: Step): Set<string> {
  const seen = new Set<string>();
  const queue: string[] = [];

  const visit = (v: TraceValue | undefined) => {
    if (v?.ref && !seen.has(v.ref)) {
      seen.add(v.ref);
      queue.push(v.ref);
    }
  };

  for (const frame of step.frames) {
    for (const value of Object.values(frame.locals)) visit(value);
  }

  while (queue.length) {
    const obj = step.heap[queue.shift()!];
    if (!obj) continue;
    obj.items?.forEach(visit);
    obj.entries?.forEach((e) => {
      visit(e.key);
      visit(e.value);
    });
    if (obj.fields) Object.values(obj.fields).forEach(visit);
  }

  return seen;
}
