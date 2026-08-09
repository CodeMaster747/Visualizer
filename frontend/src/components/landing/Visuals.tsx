/**
 * The four section visuals.
 *
 * Each one is a stripped-down piece of the real product -- the code pane, the
 * heap graph, the trace document, the transport -- built from the same tokens
 * as the app itself. Screenshots would go stale the first time a panel moves;
 * a decorative illustration would promise something the app does not look
 * like. These are neither: they are the actual UI at low fidelity, so the
 * landing page ages with the app and sets an accurate expectation of it.
 *
 * Monotone throughout. Accent appears exactly where it does in the app -- the
 * current line, the current step -- and nowhere else.
 */

import { Icon, type IconName } from "../ui/Icon";

/** The bordered card every visual sits in, with a mono caption strip. */
function Frame({
  icon, label, children,
}: {
  icon: IconName;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex h-10 items-center gap-2 border-b border-border-soft px-4">
        <Icon name={icon} size={14} className="shrink-0 text-ink-faint" />
        <span className="truncate font-mono text-xs text-ink-faint">{label}</span>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   1. Libraries. A code pane mid-run: the import is behind us, the current
   line is inside pandas, and the step count stayed in single digits.
   -------------------------------------------------------------------------- */

const LIBRARY_LINES: [text: string, current: boolean][] = [
  ["import pandas as pd", false],
  ["", false],
  ['df = pd.read_csv("sales.csv")', false],
  ['totals = df.groupby("region").sum()', true],
  ["print(totals)", false],
];

export function LibrariesVisual() {
  return (
    <Frame icon="file" label="sales.py">
      <div className="font-mono text-sm leading-[1.9]">
        {LIBRARY_LINES.map(([text, current], i) => (
          <div
            key={i}
            className={`-mx-2 flex items-center gap-3 rounded-md px-2 ${
              current ? "bg-accent-soft" : ""
            }`}
          >
            <span className="tnum w-4 shrink-0 text-right text-ink-faint">{i + 1}</span>
            <span className={`truncate ${current ? "text-ink" : "text-ink-dim"}`}>
              {text || " "}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-6 flex items-center justify-between border-t border-border-soft pt-4">
        <span className="text-xs text-ink-faint">Traced in full</span>
        <span className="tnum text-xs text-ink-dim">8 steps · 0.16s</span>
      </div>
    </Frame>
  );
}

/* --------------------------------------------------------------------------
   2. The heap. Two names on one object, and two objects on each other --
   the two shapes a structural dump cannot represent.
   -------------------------------------------------------------------------- */

export function HeapVisual() {
  return (
    <Frame icon="box" label="heap · 2 refs · 1 cycle">
      <svg viewBox="0 0 310 132" className="w-full" role="img" aria-label="Two variables referencing one object, and two objects referencing each other">
        <defs>
          <marker
            id="landing-arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0 1.5 7 4 0 6.5z" fill="var(--color-edge)" />
          </marker>
        </defs>

        {/* Variables. */}
        {([["a", 20], ["b", 84]] as const).map(([name, y]) => (
          <g key={name}>
            <rect
              x="1" y={y} width="42" height="28" rx="6"
              fill="var(--color-surface-2)"
              stroke="var(--color-border)"
            />
            <text
              x="22" y={y + 18}
              textAnchor="middle"
              fill="var(--color-ink-dim)"
              fontFamily="var(--font-mono)"
              fontSize="12"
            >
              {name}
            </text>
          </g>
        ))}

        {/* Objects. */}
        {([["Node", "#1", 104], ["Node", "#2", 228]] as const).map(([label, id, x]) => (
          <g key={id}>
            <rect
              x={x} y="38" width="78" height="46" rx="8"
              fill="var(--color-surface-3)"
              stroke="var(--color-border-strong)"
            />
            <text
              x={x + 39} y="58"
              textAnchor="middle"
              fill="var(--color-ink)"
              fontFamily="var(--font-mono)"
              fontSize="11"
            >
              {label}
            </text>
            <text
              x={x + 39} y="73"
              textAnchor="middle"
              fill="var(--color-ink-faint)"
              fontFamily="var(--font-mono)"
              fontSize="10"
            >
              {id}
            </text>
          </g>
        ))}

        {/* Aliasing: both names land on Node #1. */}
        <g fill="none" stroke="var(--color-edge)" strokeWidth="1.5" markerEnd="url(#landing-arrow)">
          <path d="M43 34C74 34 74 52 104 52" />
          <path d="M43 98C74 98 74 70 104 70" />
          {/* The cycle. */}
          <path d="M182 50C200 34 210 34 228 50" />
          <path d="M228 72C210 88 200 88 182 72" />
        </g>
      </svg>
    </Frame>
  );
}

/* --------------------------------------------------------------------------
   3. Four languages, one document. The fan-in is the point, so the languages
   are a row and the trace is the single bar they all resolve to.
   -------------------------------------------------------------------------- */

const LANGUAGES = ["Python", "Java", "JavaScript", "TypeScript"];

export function LanguagesVisual() {
  return (
    <Frame icon="layers" label="one replayer">
      <div className="grid grid-cols-2 gap-2">
        {LANGUAGES.map((name) => (
          <div
            key={name}
            className="flex h-control-lg items-center justify-center rounded-lg border border-border
                       bg-surface-2 text-sm text-ink-dim"
          >
            {name}
          </div>
        ))}
      </div>

      {/* Four lines converging on one. Stretched to the card's width, so the
          stroke has to opt out of the scale or the verticals come out four
          times heavier than the horizontals. */}
      <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-6 w-full" aria-hidden="true">
        <g
          fill="none"
          stroke="var(--color-border-strong)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        >
          <path d="M25 0V9H50V24" vectorEffect="non-scaling-stroke" />
          <path d="M75 0V9H50V24" vectorEffect="non-scaling-stroke" />
        </g>
      </svg>

      <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2 px-4 py-3">
        <span className="font-mono text-sm text-ink">trace-v1.json</span>
        <span className="text-xs text-ink-faint">steps · stack · heap</span>
      </div>
    </Frame>
  );
}

/* --------------------------------------------------------------------------
   4. Playback. The run is already finished, so the transport is a scrubber
   over a complete document rather than a progress bar over a live process.
   -------------------------------------------------------------------------- */

const TRANSPORT: IconName[] = ["skipStart", "stepBack", "play", "stepForward", "skipEnd"];

export function PlaybackVisual() {
  return (
    <Frame icon="clock" label="timeline">
      <div className="flex items-center gap-2">
        {TRANSPORT.map((name) => (
          <span
            key={name}
            className={`flex h-control-sm w-control-sm items-center justify-center rounded-lg ${
              name === "play"
                ? "bg-accent text-on-accent"
                : "border border-border bg-surface-2 text-ink-dim"
            }`}
          >
            <Icon name={name} size={14} filled />
          </span>
        ))}
        <span className="tnum ml-auto text-xs text-ink-dim">42 / 118</span>
      </div>

      {/* The scrubber, at step 42. */}
      <div className="relative mt-6 h-1 rounded-full bg-surface-3">
        <div className="absolute inset-y-0 left-0 w-[36%] rounded-full bg-accent" />
        <div className="absolute left-[36%] top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink" />
      </div>

      <p className="mt-6 border-t border-border-soft pt-4 text-sm leading-relaxed text-ink-dim">
        <span className="text-ink-faint">Step 42 — </span>
        <code className="font-mono text-xs text-ink">totals</code> now points at the
        grouped frame; the original <code className="font-mono text-xs text-ink">df</code> is
        unchanged.
      </p>
    </Frame>
  );
}
