/**
 * Heap graph layout.
 *
 * Nodes are assigned to columns by BFS distance from the stack roots, so data
 * flows left-to-right away from the variables that name it.
 *
 * Why not a real layout engine (elk/dagre): those optimise each frame in
 * isolation, so adding one node can reshuffle everything. Across a stepped
 * animation that reads as the graph exploding and reassembling. A stable,
 * deterministic assignment is worth far more here than optimal edge routing --
 * continuity between steps IS the product.
 */

import type { HeapObject, Step, TraceValue } from "../types/trace";

export interface GraphEdge {
  from: string;
  to: string;
  /** Slot label on the source side, e.g. a field name or list index. */
  label?: string;
  /** Edges originating at a stack variable rather than another heap object. */
  fromFrame?: boolean;
}

export interface GraphLayout {
  /** Object ids per column, index 0 = nearest the stack. */
  columns: string[][];
  edges: GraphEdge[];
  columnOf: Map<string, number>;
}

function refsOf(obj: HeapObject | undefined): { ref: string; label?: string }[] {
  if (!obj) return [];
  const out: { ref: string; label?: string }[] = [];
  const take = (v: TraceValue | undefined, label?: string) => {
    if (v?.ref) out.push({ ref: v.ref, label });
  };

  obj.items?.forEach((v, i) => take(v, String(i)));
  obj.entries?.forEach((e, i) => {
    take(e.key, `key${i}`);
    take(e.value, `val${i}`);
  });
  if (obj.fields) {
    for (const [name, v] of Object.entries(obj.fields)) take(v, name);
  }
  return out;
}

/**
 * BFS from stack roots. Cycle-safe: a node keeps the first (shortest) column it
 * is assigned, so a back-edge in a linked list never drags a node rightward
 * forever.
 */
export function computeLayout(step: Step): GraphLayout {
  const columnOf = new Map<string, number>();
  const edges: GraphEdge[] = [];
  const queue: { id: string; depth: number }[] = [];

  // Roots: everything a frame variable points at directly.
  for (const frame of step.frames) {
    for (const [name, value] of Object.entries(frame.locals)) {
      if (!value.ref) continue;
      edges.push({
        from: `${frame.id}.${name}`,
        to: value.ref,
        label: name,
        fromFrame: true,
      });
      if (!columnOf.has(value.ref)) {
        columnOf.set(value.ref, 0);
        queue.push({ id: value.ref, depth: 0 });
      }
    }
  }

  while (queue.length) {
    const { id, depth } = queue.shift()!;
    for (const { ref, label } of refsOf(step.heap[id])) {
      edges.push({ from: id, to: ref, label });
      if (!columnOf.has(ref)) {
        columnOf.set(ref, depth + 1);
        queue.push({ id: ref, depth: depth + 1 });
      }
    }
  }

  // Unreachable objects still present in the heap: park them in column 0 so a
  // tracer bug shows up on screen instead of silently vanishing.
  for (const id of Object.keys(step.heap)) {
    if (!columnOf.has(id)) columnOf.set(id, 0);
  }

  const width = Math.max(0, ...[...columnOf.values()].map((d) => d + 1));
  const columns: string[][] = Array.from({ length: width }, () => []);
  // Sort within a column by id so ordering is stable between steps rather than
  // dependent on object insertion order.
  const sorted = [...columnOf.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [id, depth] of sorted) columns[depth].push(id);

  return { columns, edges, columnOf };
}

/** Cubic bezier between two anchor points, flattened for short horizontal runs. */
export function edgePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  const dx = Math.abs(x2 - x1);
  const curve = Math.min(Math.max(dx * 0.45, 24), 120);
  return `M ${x1},${y1} C ${x1 + curve},${y1} ${x2 - curve},${y2} ${x2},${y2}`;
}

/**
 * Back edge: the target is level with or behind the source, which happens
 * constantly with cyclic structures (a.next = b; b.next = a) because both nodes
 * are one hop from a stack root and land in the same column.
 *
 * A straight bezier between them runs right-to-left straight through the cards
 * and is invisible. Instead we exit the right side of the source, bow out, and
 * re-enter the right side of the target -- the standard back-edge treatment,
 * and the only reason a cycle reads as a cycle on screen.
 */
export function backEdgePath(
  sourceRight: number,
  y1: number,
  targetRight: number,
  y2: number,
): string {
  const bow = 46 + Math.min(Math.abs(y2 - y1) * 0.25, 40);
  const x = Math.max(sourceRight, targetRight);
  return `M ${sourceRight},${y1} C ${x + bow},${y1} ${x + bow},${y2} ${targetRight},${y2}`;
}

/**
 * Self-referential edge (node points at itself). A bezier to the same point is
 * invisible, so draw a loop out to the right.
 */
export function selfLoopPath(x: number, y: number): string {
  return `M ${x},${y} C ${x + 60},${y - 28} ${x + 60},${y + 28} ${x},${y + 2}`;
}
