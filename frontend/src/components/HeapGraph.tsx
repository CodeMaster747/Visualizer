/**
 * The heap pane: object cards in BFS columns, with arrows drawn between them.
 *
 * Edges are measured from the real DOM rather than computed from a layout
 * model. That means rich cards (a DataFrame table, a numpy grid) can be any
 * size they like and the arrows still land exactly on their anchors -- no
 * size estimation to keep in sync with the renderers.
 */

import { AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { HeapNode } from "./HeapNode";
import { backEdgePath, computeLayout, edgePath, selfLoopPath } from "../lib/layout";
import { reachableObjects } from "../lib/diff";
import { usePlayback } from "../store/playback";
import { useCurrentDiff, useCurrentStep } from "../store/selectors";

interface Line {
  key: string;
  d: string;
  to: string;
  from: string;
}

/** How long to keep re-measuring after a step change, in ms. Must comfortably
 *  outlast the card layout spring or edges freeze mid-flight. */
const TRACK_MS = 700;

export function HeapGraph() {
  const step = useCurrentStep();
  const diff = useCurrentDiff();
  const hovered = usePlayback((s) => s.hoveredObject);

  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLElement>());
  const [lines, setLines] = useState<Line[]>([]);

  const setNodeRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) nodeRefs.current.set(id, el);
    else nodeRefs.current.delete(id);
  }, []);

  const layout = useMemo(() => (step ? computeLayout(step) : null), [step]);
  const reachable = useMemo(
    () => (step ? reachableObjects(step) : new Set<string>()),
    [step],
  );

  const measure = useCallback(() => {
    const root = containerRef.current?.getBoundingClientRect();
    if (!layout || !root) {
      setLines((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    const next: Line[] = [];
    for (const edge of layout.edges) {
      // Stack-variable edges live in a different scroll box; here we only draw
      // heap-to-heap.
      if (edge.fromFrame) continue;

      const a = nodeRefs.current.get(edge.from);
      const b = nodeRefs.current.get(edge.to);
      if (!a || !b) continue;

      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const y1 = ra.top - root.top + ra.height / 2;
      const y2 = rb.top - root.top + rb.height / 2;
      const aRight = ra.right - root.left;
      const bLeft = rb.left - root.left;
      const bRight = rb.right - root.left;

      let d: string;
      if (edge.from === edge.to) {
        d = selfLoopPath(aRight, y1);
      } else if (bLeft > aRight + 8) {
        d = edgePath(aRight, y1, bLeft, y2);
      } else {
        // Same column or behind: route it around the outside.
        d = backEdgePath(aRight, y1, bRight, y2);
      }

      next.push({
        key: `${edge.from}->${edge.to}:${edge.label ?? ""}`,
        d,
        from: edge.from,
        to: edge.to,
      });
    }

    setLines((prev) => {
      if (
        prev.length === next.length &&
        prev.every((p, i) => p.key === next[i].key && p.d === next[i].d)
      ) {
        return prev; // identical geometry -- returning prev stops the loop
      }
      return next;
    });
  }, [layout]);

  /**
   * Runs on every commit, with NO dependency array: node sizes change for
   * reasons React cannot see (a DataFrame card growing, a scroll, a font
   * loading). The equality bail-out inside `measure` is what stops this from
   * being an infinite render loop.
   */
  useLayoutEffect(measure);

  /**
   * Framer cannot interpolate an arbitrary SVG path `d` -- feeding it one
   * produces literal "undefined". So rather than animating the edges, we
   * re-measure them every frame while the cards are still springing into
   * place. The arrows then follow the true motion of the nodes, which looks
   * better than any interpolation would and costs a handful of rAF ticks.
   */
  useEffect(() => {
    let raf = 0;
    const started = performance.now();
    const tick = () => {
      measure();
      if (performance.now() - started < TRACK_MS) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step, measure]);

  // Re-measure when the pane itself changes size (window resize, panel drag).
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [measure]);

  if (!step || !layout) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-ink-faint">
        No objects yet
      </div>
    );
  }

  const visible = layout.columns.map((col) => col.filter((id) => reachable.has(id)));
  const isEmpty = visible.every((c) => c.length === 0);

  return (
    <div ref={containerRef} className="relative h-full overflow-auto p-4">
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="var(--color-edge)" />
          </marker>
          <marker id="arrow-hot" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="var(--color-accent)" />
          </marker>
        </defs>
        {lines.map((l) => {
          const hot = hovered === l.from || hovered === l.to;
          return (
            <path
              key={l.key}
              d={l.d}
              stroke={hot ? "var(--color-accent)" : "var(--color-edge)"}
              strokeWidth={hot ? 2 : 1.5}
              opacity={hot ? 1 : 0.75}
              fill="none"
              markerEnd={hot ? "url(#arrow-hot)" : "url(#arrow)"}
              style={{ transition: "stroke 150ms, opacity 150ms, stroke-width 150ms" }}
            />
          );
        })}
      </svg>

      {isEmpty ? (
        <div className="flex h-full items-center justify-center text-[12px] text-ink-faint">
          All values are primitives — nothing on the heap yet
        </div>
      ) : (
        <div className="relative flex items-start gap-16">
          {visible.map((col, ci) => (
            // items-start keeps each card at its natural width; without it
            // flex stretches every card to the widest one in the column.
            <div key={ci} className="flex min-w-[140px] flex-col items-start gap-4">
              <AnimatePresence mode="popLayout">
                {col.map((id) => (
                  <div key={id} ref={(el) => setNodeRef(id, el)}>
                    <HeapNode
                      id={id}
                      obj={step.heap[id]}
                      heap={step.heap}
                      changed={diff.changedObjects.has(id)}
                      isNew={diff.newObjects.has(id)}
                    />
                  </div>
                ))}
              </AnimatePresence>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
