import { describe, expect, it } from "vitest";

import { changePointsFor, diffSteps, reachableObjects } from "./diff";
import type { Step, TraceValue } from "../types/trace";

const p = (v: number): TraceValue => ({ prim: v, prim_type: "int" });
const r = (id: string): TraceValue => ({ ref: id });

function step(
  i: number,
  locals: Record<string, TraceValue>,
  heap: Step["heap"] = {},
  frames?: Step["frames"],
): Step {
  return {
    i,
    line: i + 1,
    event: "line",
    frames: frames ?? [
      { id: "f0", name: "<module>", line: i + 1, locals, is_global: true },
    ],
    heap,
  };
}

describe("diffSteps", () => {
  it("treats the first step as new, not changed, so nothing flashes on load", () => {
    const d = diffSteps(undefined, step(0, { a: p(1) }, { o1: { kind: "list" } }));
    expect(d.newVars).toContain("f0.a");
    expect(d.changedVars.size).toBe(0);
    expect(d.newObjects).toContain("o1");
  });

  it("detects a primitive reassignment", () => {
    const d = diffSteps(step(0, { a: p(1) }), step(1, { a: p(2) }));
    expect([...d.changedVars]).toEqual(["f0.a"]);
    expect(d.newVars.size).toBe(0);
  });

  it("does not report an unchanged variable", () => {
    const d = diffSteps(step(0, { a: p(1) }), step(1, { a: p(1), b: p(9) }));
    expect(d.changedVars.size).toBe(0);
    expect([...d.newVars]).toEqual(["f0.b"]);
  });

  it("distinguishes int 1 from float 1.0", () => {
    const a = step(0, { x: { prim: 1, prim_type: "int" } });
    const b = step(1, { x: { prim: 1, prim_type: "float" } });
    expect(diffSteps(a, b).changedVars.has("f0.x")).toBe(true);
  });

  it("flags a mutated list once, not every alias pointing at it", () => {
    const before = step(0, { a: r("o1"), b: r("o1") }, {
      o1: { kind: "list", items: [p(1)] },
    });
    const after = step(1, { a: r("o1"), b: r("o1") }, {
      o1: { kind: "list", items: [p(1), p(2)] },
    });
    const d = diffSteps(before, after);
    // Neither name was reassigned -- only the object behind them mutated.
    expect(d.changedVars.size).toBe(0);
    expect([...d.changedObjects]).toEqual(["o1"]);
  });

  it("flags rebinding a name to a different object", () => {
    const before = step(0, { a: r("o1") }, { o1: { kind: "list" }, o2: { kind: "list" } });
    const after = step(1, { a: r("o2") }, { o1: { kind: "list" }, o2: { kind: "list" } });
    expect(diffSteps(before, after).changedVars.has("f0.a")).toBe(true);
  });

  it("flags an in-place rich-value edit even when shape and repr are unchanged", () => {
    // `arr *= 10` keeps kind/shape/repr identical while every cell changes.
    // Comparing only the summary would miss it entirely.
    const before = step(0, { arr: r("o1") }, {
      o1: { kind: "ndarray", shape: [2], repr: "ndarray(2,)", preview: [[1, 2]] },
    });
    const after = step(1, { arr: r("o1") }, {
      o1: { kind: "ndarray", shape: [2], repr: "ndarray(2,)", preview: [[10, 20]] },
    });
    expect([...diffSteps(before, after).changedObjects]).toEqual(["o1"]);
  });

  it("does not flag a rich value whose preview is identical", () => {
    const before = step(0, { arr: r("o1") }, {
      o1: { kind: "ndarray", shape: [2], repr: "ndarray(2,)", preview: [[1, 2]] },
    });
    const after = step(1, { arr: r("o1"), other: p(1) }, {
      o1: { kind: "ndarray", shape: [2], repr: "ndarray(2,)", preview: [[1, 2]] },
    });
    expect(diffSteps(before, after).changedObjects.size).toBe(0);
  });

  it("does not cascade a nested mutation onto its parent container", () => {
    // o1 holds a ref to o2; only o2's contents change. o1 itself is untouched,
    // so highlighting it would be a false positive.
    const before = step(0, { a: r("o1") }, {
      o1: { kind: "list", items: [r("o2")] },
      o2: { kind: "list", items: [p(1)] },
    });
    const after = step(1, { a: r("o1") }, {
      o1: { kind: "list", items: [r("o2")] },
      o2: { kind: "list", items: [p(2)] },
    });
    const d = diffSteps(before, after);
    expect([...d.changedObjects]).toEqual(["o2"]);
  });

  it("tracks frame pushes and pops", () => {
    const before = step(0, { a: p(1) });
    const after = step(1, {}, {}, [
      { id: "f0", name: "<module>", line: 1, locals: { a: p(1) }, is_global: true },
      { id: "fact#1", name: "fact", line: 2, locals: { n: p(4) } },
    ]);
    const pushed = diffSteps(before, after);
    expect([...pushed.pushedFrames]).toEqual(["fact#1"]);

    const popped = diffSteps(after, before);
    expect([...popped.poppedFrames]).toEqual(["fact#1"]);
  });

  it("keeps recursive frames independent via distinct ids", () => {
    const one = step(0, {}, {}, [
      { id: "f0", name: "<module>", line: 1, locals: {}, is_global: true },
      { id: "fact#1", name: "fact", line: 2, locals: { n: p(4) } },
    ]);
    const two = step(1, {}, {}, [
      { id: "f0", name: "<module>", line: 1, locals: {}, is_global: true },
      { id: "fact#1", name: "fact", line: 2, locals: { n: p(4) } },
      { id: "fact#2", name: "fact", line: 2, locals: { n: p(3) } },
    ]);
    const d = diffSteps(one, two);
    expect([...d.pushedFrames]).toEqual(["fact#2"]);
    // The outer frame's n must NOT read as changed just because a new frame
    // with the same variable name appeared.
    expect(d.changedVars.size).toBe(0);
  });
});

describe("changePointsFor", () => {
  it("returns only the steps where the value actually changes", () => {
    const steps = [
      step(0, { x: p(1) }),
      step(1, { x: p(1) }),
      step(2, { x: p(2) }),
      step(3, { x: p(2) }),
      step(4, { x: p(3) }),
    ];
    expect(changePointsFor(steps, "x")).toEqual([0, 2, 4]);
  });

  it("ignores steps where the variable does not exist", () => {
    const steps = [step(0, {}), step(1, { y: p(5) }), step(2, { y: p(5) })];
    expect(changePointsFor(steps, "y")).toEqual([1]);
  });
});

describe("reachableObjects", () => {
  it("terminates on a cycle", () => {
    const s = step(0, { a: r("o1") }, {
      o1: { kind: "instance", fields: { next: r("o2") } },
      o2: { kind: "instance", fields: { next: r("o1") } },
    });
    expect([...reachableObjects(s)].sort()).toEqual(["o1", "o2"]);
  });

  it("excludes unreachable heap entries", () => {
    const s = step(0, { a: r("o1") }, {
      o1: { kind: "list" },
      o99: { kind: "list" },
    });
    expect([...reachableObjects(s)]).toEqual(["o1"]);
  });

  it("follows dict keys and values", () => {
    const s = step(0, { d: r("o1") }, {
      o1: { kind: "dict", entries: [{ key: r("o2"), value: r("o3") }] },
      o2: { kind: "tuple" },
      o3: { kind: "list" },
    });
    expect([...reachableObjects(s)].sort()).toEqual(["o1", "o2", "o3"]);
  });
});
