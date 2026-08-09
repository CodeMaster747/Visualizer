/**
 * Renders one heap object as a card.
 *
 * Dispatch is a registry keyed on `kind` with a generic fallback, so adding a
 * rich type (Tensor, Graph, whatever) is a local change here and a tracer
 * change -- never a schema bump and never a change to the replayer core.
 */

import { motion } from "framer-motion";
import type { JSX } from "react";

import { ValueChip } from "./ValueChip";
import { orderedFields, type HeapObject } from "../types/trace";
import { usePlayback } from "../store/playback";

interface RendererProps {
  obj: HeapObject;
  heap: Record<string, HeapObject>;
}

const cell =
  "px-2 py-1 font-mono text-2xs text-ink-dim whitespace-nowrap";

function TruncationNote({ obj }: { obj: HeapObject }) {
  const shown = obj.items?.length ?? obj.preview?.length ?? 0;
  const total = obj.total ?? obj.shape?.[0];
  if (!obj.truncated || total === undefined || total <= shown) return null;
  return (
    <div className="px-3 py-2 text-2xs italic text-ink-faint">
      … {total - shown} more (truncated)
    </div>
  );
}

/** list / tuple / set / deque -- indexed cells so position is legible. */
function SequenceRenderer({ obj, heap }: RendererProps) {
  const items = obj.items ?? [];
  const indexed = obj.kind === "list" || obj.kind === "tuple";
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 p-3">
        {items.map((item, i) => (
          <div key={i} className="flex flex-col items-center gap-0.5">
            {indexed && <span className="text-2xs text-ink-faint">{i}</span>}
            <ValueChip value={item} heap={heap} />
          </div>
        ))}
        {items.length === 0 && (
          <span className="px-1 text-xs italic text-ink-faint">empty</span>
        )}
      </div>
      <TruncationNote obj={obj} />
    </div>
  );
}

function DictRenderer({ obj, heap }: RendererProps) {
  const entries = obj.entries ?? [];
  return (
    <div>
      <table className="w-full border-collapse">
        <tbody>
          {entries.map((e, i) => (
            <tr key={i} className="border-t border-border-soft">
              <td className="py-1.5 pl-3 pr-4">
                <ValueChip value={e.key} heap={heap} />
              </td>
              <td className="py-1.5 pr-3 text-right">
                <ValueChip value={e.value} heap={heap} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length === 0 && (
        <span className="block px-3 py-2 text-xs italic text-ink-faint">empty</span>
      )}
      <TruncationNote obj={obj} />
    </div>
  );
}

/**
 * User classes and instances -- explicitly missing from existing tools.
 *
 * Methods and the MRO render only on the CLASS card. Repeating them on every
 * instance triples the height of each box to restate something already on
 * screen, and buries the fields, which are the part that actually changes.
 */
function InstanceRenderer({ obj, heap }: RendererProps) {
  const fields = orderedFields(obj);
  const showClassInfo = obj.kind === "class";
  return (
    <div>
      <table className="w-full border-collapse">
        <tbody>
          {fields.map(([name, value]) => (
            <tr key={name} className="border-t border-border-soft">
              <td className="py-1.5 pl-3 pr-4 font-mono text-xs text-ink-dim">
                {name}
              </td>
              <td className="py-1.5 pr-3 text-right">
                <ValueChip value={value} heap={heap} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {showClassInfo && obj.methods && obj.methods.length > 0 && (
        <div className="border-t border-border-soft px-3 py-2">
          <div className="flex flex-wrap gap-1.5">
            {obj.methods.map((m) => (
              <span
                key={m}
                className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-ink-faint"
              >
                {m}()
              </span>
            ))}
          </div>
        </div>
      )}
      {showClassInfo && obj.mro && obj.mro.length > 1 && (
        <div className="border-t border-border-soft px-3 py-2 font-mono text-2xs text-ink-faint">
          {obj.mro.join(" → ")}
        </div>
      )}
    </div>
  );
}

/** DataFrame -- a real table, because that is how the user thinks about it. */
function DataFrameRenderer({ obj }: RendererProps) {
  const cols = obj.columns ?? [];
  const rows = obj.preview ?? [];
  return (
    <div className="max-w-[420px] overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-surface-2">
            <th className={`${cell} text-ink-faint`} />
            {cols.map((c) => (
              <th key={c} className={`${cell} text-left font-semibold text-ink`}>
                {c}
                {obj.dtypes?.[c] && (
                  <span className="ml-1 font-normal text-ink-faint">
                    {obj.dtypes[c]}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-border-soft">
              <td className={`${cell} text-ink-faint`}>{obj.index?.[i] ?? i}</td>
              {row.map((v, j) => (
                <td key={j} className={cell}>
                  {v === null ? <span className="text-ink-faint">NaN</span> : String(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <TruncationNote obj={obj} />
    </div>
  );
}

/** Series -- an index/value pair table. */
function SeriesRenderer({ obj }: RendererProps) {
  const rows = obj.preview ?? [];
  return (
    <div className="max-w-[280px] overflow-x-auto">
      <table className="w-full border-collapse">
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-border-soft">
              <td className={`${cell} text-ink-faint`}>{String(row[0])}</td>
              <td className={`${cell} text-right text-ink`}>{String(row[1])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <TruncationNote obj={obj} />
    </div>
  );
}

/**
 * ndarray -- a numeric grid. Cells are tinted by magnitude so the *shape* of
 * the data is visible at a glance, which matters far more than exact digits
 * when you are watching an algorithm transform a matrix.
 */
function NdArrayRenderer({ obj }: RendererProps) {
  const rows = obj.preview ?? [];
  const nums = rows.flat().filter((v): v is number => typeof v === "number");
  const min = Math.min(...nums, 0);
  const max = Math.max(...nums, 1);
  const norm = (v: number) => (max === min ? 0.5 : (v - min) / (max - min));

  return (
    <div className="max-w-[380px] overflow-x-auto p-2">
      <div className="inline-grid gap-0.5"
           style={{ gridTemplateColumns: `repeat(${rows[0]?.length ?? 1}, minmax(0, 1fr))` }}>
        {rows.flatMap((row, i) =>
          row.map((v, j) => (
            <div
              key={`${i}-${j}`}
              className="rounded-sm px-1.5 py-1 text-center font-mono text-2xs text-ink"
              style={{
                background:
                  typeof v === "number"
                    ? `color-mix(in oklab, var(--color-accent) ${norm(v) * 55 + 8}%, var(--color-surface-2))`
                    : "var(--color-surface-2)",
              }}
            >
              {v === null ? "·" : String(v)}
            </div>
          )),
        )}
      </div>
      <TruncationNote obj={obj} />
    </div>
  );
}

function GenericRenderer({ obj }: RendererProps) {
  return (
    <div className="px-3 py-2 font-mono text-xs leading-relaxed text-ink-dim break-all">
      {obj.repr ?? obj.kind}
    </div>
  );
}

const RENDERERS: Record<string, (p: RendererProps) => JSX.Element> = {
  list: SequenceRenderer,
  tuple: SequenceRenderer,
  set: SequenceRenderer,
  deque: SequenceRenderer,
  dict: DictRenderer,
  instance: InstanceRenderer,
  class: InstanceRenderer,
  dataframe: DataFrameRenderer,
  series: SeriesRenderer,
  ndarray: NdArrayRenderer,
};

/**
 * Header emphasis, by weight rather than hue.
 *
 * The heading already names the kind, so tint was never carrying the meaning
 * on its own -- it only ranked things. Brightness ranks them just as well and
 * leaves the loudest step on the ramp free for the value that just changed.
 */
const KIND_ACCENT: Record<string, string> = {
  // The reader's own types, and the rich tabular ones: full strength.
  instance: "text-ink",
  class: "text-ink",
  dataframe: "text-ink",
  series: "text-ink",
  ndarray: "text-ink",
  // Machinery they did not write: present, but receding.
  function: "text-ink-faint",
  module: "text-ink-faint",
};

interface HeapNodeProps {
  id: string;
  obj: HeapObject;
  heap: Record<string, HeapObject>;
  changed?: boolean;
  isNew?: boolean;
}

export function HeapNode({ id, obj, heap, changed, isNew }: HeapNodeProps) {
  const hovered = usePlayback((s) => s.hoveredObject);
  const setHovered = usePlayback((s) => s.setHoveredObject);
  const Renderer = RENDERERS[obj.kind] ?? GenericRenderer;
  const isHot = hovered === id;

  const title =
    obj.kind === "instance"
      ? (obj.class ?? "object")
      : obj.kind === "class"
        ? `class ${obj.class ?? ""}`
        : obj.kind === "function"
          ? `ƒ ${obj.name ?? ""}`
          : obj.kind === "module"
            ? `module ${obj.name ?? ""}`
            : obj.kind;

  return (
    <motion.div
      layout
      layoutId={`node-${id}`}
      initial={isNew ? { opacity: 0, scale: 0.9 } : false}
      animate={{
        opacity: 1,
        scale: 1,
        borderColor: isHot
          ? "var(--color-accent)"
          : changed
            ? ["var(--color-changed)", "var(--color-border)"]
            : "var(--color-border)",
        // A ring, not a drop shadow: cards should read as layered surfaces
        // rather than floating objects.
        boxShadow: isHot ? "0 0 0 1px var(--color-accent)" : "0 0 0 0 transparent",
      }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{
        borderColor: { duration: 1.1, ease: "easeOut" },
        layout: { type: "spring", stiffness: 320, damping: 32 },
        default: { duration: 0.2 },
      }}
      onMouseEnter={() => setHovered(id)}
      onMouseLeave={() => setHovered(null)}
      className="overflow-hidden rounded-lg border bg-surface"
    >
      <div className="flex h-7 items-center justify-between gap-3 border-b border-border-soft
                      bg-surface-2 px-3">
        <span className={`truncate font-mono text-xs font-medium ${KIND_ACCENT[obj.kind] ?? "text-ink-dim"}`}>
          {title}
        </span>
        <span className="shrink-0 font-mono text-2xs text-ink-faint">{id}</span>
      </div>
      <Renderer obj={obj} heap={heap} />
    </motion.div>
  );
}
