/**
 * Renders a single slot: an inlined primitive, or a stub standing in for a
 * heap object with an arrow drawn to it.
 *
 * Primitives animate their VALUE (the number visibly changes); references
 * animate their EDGE (the arrow swings to a new target). Keeping those two
 * cases visually distinct is what teaches the value/reference distinction
 * without a word of explanation.
 */

import { motion } from "framer-motion";

import { DEFAULT_LITERALS, formatPrim, type HeapObject, type TraceValue } from "../types/trace";
import { usePlayback } from "../store/playback";

const TYPE_COLOR: Record<string, string> = {
  int: "text-t-int",
  long: "text-t-int",
  float: "text-t-int",
  double: "text-t-int",
  str: "text-t-str",
  char: "text-t-str",
  bool: "text-t-bool",
  null: "text-t-null",
};

/** Compact label for the stub, so a reference reads as "list(4)" not "o7". */
export function summarize(obj: HeapObject | undefined): string {
  if (!obj) return "?";
  switch (obj.kind) {
    case "list":
    case "tuple":
    case "set":
    case "deque":
      return `${obj.kind}(${obj.total ?? obj.items?.length ?? 0})`;
    case "dict":
      return `dict(${obj.entries?.length ?? 0})`;
    case "instance":
      return obj.class ?? "object";
    case "class":
      return `class ${obj.class ?? ""}`.trim();
    case "function":
      return `ƒ ${obj.name ?? ""}`.trim();
    case "module":
      return obj.name ?? "module";
    case "dataframe":
      return `DataFrame ${obj.shape?.join("×") ?? ""}`;
    case "series":
      return `Series[${obj.shape?.[0] ?? "?"}]`;
    case "ndarray":
      return `ndarray ${obj.shape?.join("×") ?? ""}`;
    default:
      return obj.repr ?? obj.kind;
  }
}

interface Props {
  value: TraceValue;
  heap: Record<string, HeapObject>;
  /** Drives the amber flash. Owned by the caller because only it knows whether
   *  this particular slot is what changed. */
  changed?: boolean;
  isNew?: boolean;
}

export function ValueChip({ value, heap, changed, isNew }: Props) {
  const hovered = usePlayback((s) => s.hoveredObject);
  const setHovered = usePlayback((s) => s.setHoveredObject);
  // Supplied by the tracer, so `null` prints as None, null or undefined
  // without this component ever asking which language it is looking at.
  const literals = usePlayback((s) => s.trace?.meta?.literals) ?? DEFAULT_LITERALS;

  if (value.ref) {
    const obj = heap[value.ref];
    const isHot = hovered === value.ref;
    return (
      <motion.span
        // Deliberately NO layoutId here. Keying it on the target id looked
        // appealing (shared-element transition into the heap node) but aliasing
        // -- the whole point of this view -- means several chips legitimately
        // point at the SAME object, and Framer collapses duplicate layoutIds
        // into one element. That silently erased `a` from `a = b = [...]`.
        // Cross-pane association is carried by hover highlighting instead.
        onMouseEnter={() => setHovered(value.ref!)}
        onMouseLeave={() => setHovered(null)}
        animate={{
          borderColor: isHot ? "var(--color-accent)" : "var(--color-border)",
          backgroundColor: isHot ? "var(--color-accent-soft)" : "var(--color-surface-2)",
        }}
        transition={{ duration: 0.15 }}
        // nowrap: a summary like "DataFrame 6×3" breaking across two lines
        // makes the stack row jump a whole line height as values change.
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border
                   px-2 py-0.5 font-mono text-xs text-ink-dim cursor-pointer select-none"
        title={heap[value.ref]?.repr ?? value.ref}
      >
        <span className="text-accent">→</span>
        {summarize(obj)}
      </motion.span>
    );
  }

  const color = TYPE_COLOR[value.prim_type ?? "null"] ?? "text-ink";
  return (
    <motion.span
      key={String(value.prim)}
      initial={isNew ? { opacity: 0, y: -4 } : false}
      animate={{
        opacity: 1,
        y: 0,
        backgroundColor: changed
          ? ["var(--color-changed-soft)", "var(--color-surface-2)"]
          : "var(--color-surface-2)",
        borderColor: changed
          ? ["var(--color-changed)", "var(--color-border)"]
          : "var(--color-border)",
      }}
      transition={{
        // A slow decay reads as "this is settling", which is exactly the
        // mental model we want for an assignment.
        backgroundColor: { duration: 1.1, ease: "easeOut" },
        borderColor: { duration: 1.1, ease: "easeOut" },
        default: { duration: 0.2 },
      }}
      className={`inline-block rounded-md border px-2 py-0.5 font-mono text-xs ${color}`}
    >
      {formatPrim(value, literals)}
      {value.truncated && <span className="text-ink-faint"> …</span>}
    </motion.span>
  );
}
