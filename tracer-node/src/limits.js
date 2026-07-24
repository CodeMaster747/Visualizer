/** Execution and snapshot caps, surfaced in the trace so truncation is never silent. */

/** Same defaults as tracer-python: a trace that means the same thing in any language. */
export const DEFAULTS = Object.freeze({
  // Trace length. 5000 steps is roughly the point past which scrubbing stops
  // being a useful way to find anything.
  max_steps: 5000,
  // Object graph depth from a frame variable.
  max_depth: 6,
  // Elements per container, fields per instance, rows per table.
  max_items: 100,
  // Characters per string.
  max_string: 512,
  // Wall clock. Enforced here as well as by the sandbox, so a runaway loop
  // stops with a usable partial trace instead of a killed process.
  timeout_ms: 10_000,
});

const RANGES = Object.freeze({
  max_steps: [10, 20_000],
  max_depth: [1, 12],
  max_items: [1, 500],
  max_string: [16, 4_000],
  timeout_ms: [500, 20_000],
});

/**
 * Build limits from untrusted input.
 *
 * Every field is clamped: these values come from the client, and an unbounded
 * max_steps is a trivial way to exhaust the box.
 */
export function clampLimits(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const [low, high] = RANGES[key];
    const value = Number.parseInt(input[key], 10);
    out[key] = Number.isFinite(value) ? Math.max(low, Math.min(value, high)) : fallback;
  }
  return out;
}
