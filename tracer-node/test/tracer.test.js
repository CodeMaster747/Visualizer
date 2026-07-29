/**
 * Tracer tests.
 *
 * These run real snippets in real debuggee processes -- the interesting
 * failures in a tracer are all in the interaction with V8, so a mocked
 * inspector would test nothing worth testing.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { clampLimits } from "../src/limits.js";
import { trace } from "../src/tracer.js";

const dirs = [];

async function run(source, { language = "javascript", limits = {}, stdin = "" } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "viz-test-"));
  dirs.push(dir);
  return trace({ source, language, stdin, limits: clampLimits(limits), dir });
}

after(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

/** The heap object a frame variable points at, or undefined if it is a primitive. */
function deref(step, name, frame = 0) {
  const ref = step.frames[frame].locals[name]?.ref;
  return ref ? step.heap[ref] : undefined;
}

const last = (doc) => doc.steps.at(-1);

describe("document shape", () => {
  it("emits a valid trace-v1 envelope", async () => {
    const doc = await run("const x = 1;\n");
    assert.equal(doc.version, 1);
    assert.equal(doc.language, "javascript");
    assert.equal(doc.status, "ok");
    assert.ok(doc.steps.length > 0);
    assert.equal(typeof doc.stdout, "string");
    assert.equal(doc.meta.step_count, doc.steps.length);
    assert.deepEqual(doc.meta.literals, { null: "null", true: "true", false: "false" });
  });

  it("opens on a line event rather than a call", async () => {
    const doc = await run("const x = 1;\nconst y = 2;\n");
    assert.equal(doc.steps[0].event, "line");
    assert.equal(doc.steps[0].line, 1);
  });

  it("marks the outermost frame as global", async () => {
    const doc = await run("const x = 1;\n");
    const frame = doc.steps[0].frames[0];
    assert.equal(frame.is_global, true);
    assert.equal(frame.name, "global");
  });

  it("hides the CommonJS wrapper's own bindings", async () => {
    const doc = await run("const mine = 1;\n");
    const names = last(doc).frames[0].order;
    assert.deepEqual(names.filter((n) => n === "mine"), ["mine"]);
    for (const wrapper of ["exports", "require", "module", "__filename", "__dirname"]) {
      assert.ok(!names.includes(wrapper), `${wrapper} leaked into the frame`);
    }
  });
});

describe("identity", () => {
  it("gives two names for one array the same heap id", async () => {
    const doc = await run("const a = [1, 2];\nconst b = a;\nconst c = [1, 2];\na.push(3);\n");
    const step = last(doc);
    const { a, b, c } = step.frames[0].locals;
    assert.equal(a.ref, b.ref, "aliases must share an id");
    assert.notEqual(a.ref, c.ref, "a structural copy is a different object");
    assert.equal(step.heap[a.ref].items.length, 3);
  });

  it("keeps an object's id stable across steps", async () => {
    const doc = await run("const a = [1];\na.push(2);\na.push(3);\n");
    const ids = doc.steps
      .map((s) => s.frames[0].locals.a?.ref)
      .filter(Boolean);
    assert.ok(ids.length >= 2);
    assert.equal(new Set(ids).size, 1, "the same array must keep one id");
  });

  it("represents a cycle as a reference back to the same node", async () => {
    const doc = await run(
      "class Node { constructor(v) { this.value = v; this.next = null; } }\n" +
      "const a = new Node('first');\nconst b = new Node('second');\n" +
      "a.next = b;\nb.next = a;\n",
    );
    const step = last(doc);
    const aId = step.frames[0].locals.a.ref;
    const bId = step.frames[0].locals.b.ref;
    assert.equal(step.heap[aId].fields.next.ref, bId);
    assert.equal(step.heap[bId].fields.next.ref, aId);
  });
});

describe("value encoding", () => {
  it("distinguishes null from undefined", async () => {
    const doc = await run("let a = null;\nlet b = undefined;\nlet c = 1;\n");
    const locals = last(doc).frames[0].locals;
    assert.deepEqual(locals.a, { prim: null, prim_type: "null" });
    assert.deepEqual(locals.b, { prim: "undefined", prim_type: "null" });
  });

  it("separates integers from floats", async () => {
    const doc = await run("const i = 42;\nconst f = 1.5;\nconst n = NaN;\n");
    const locals = last(doc).frames[0].locals;
    assert.equal(locals.i.prim_type, "int");
    assert.equal(locals.f.prim_type, "float");
    assert.equal(locals.n.prim, "NaN", "NaN cannot travel as JSON, so it travels as text");
  });

  it("maps each built-in container onto its own kind", async () => {
    const doc = await run(
      "const list = [1];\nconst obj = { a: 1 };\nconst map = new Map([['k', 1]]);\n" +
      "const set = new Set([1]);\nconst nums = new Float64Array([1, 2]);\n" +
      "const fn = function named() {};\nconst re = /x/g;\n",
    );
    const step = last(doc);
    assert.equal(deref(step, "list").kind, "list");
    assert.equal(deref(step, "obj").kind, "dict");
    assert.equal(deref(step, "map").kind, "dict");
    assert.equal(deref(step, "set").kind, "set");
    assert.equal(deref(step, "nums").kind, "ndarray");
    assert.equal(deref(step, "fn").kind, "function");
    assert.equal(deref(step, "re").kind, "regexp");
  });

  it("keeps a class instance's type, fields and methods", async () => {
    const doc = await run(
      "class Point { constructor(x) { this.x = x; } scaled(k) { return this.x * k; } }\n" +
      "const p = new Point(3);\n",
    );
    const obj = deref(last(doc), "p");
    assert.equal(obj.kind, "instance");
    assert.equal(obj.class, "Point");
    assert.deepEqual(obj.field_order, ["x"]);
    assert.ok(obj.methods.includes("scaled"));
  });

  it("reports getters without invoking them", async () => {
    const doc = await run(
      "const obj = { plain: 1, get boom() { throw new Error('never'); } };\nconst done = true;\n",
    );
    const dict = deref(last(doc), "obj");
    const boom = dict.entries.find((e) => e.key.prim === "boom");
    assert.equal(boom.value.prim, "<getter>");
    assert.equal(last(doc).frames[0].locals.done.prim, true);
  });

  it("truncates a long container and says so", async () => {
    const doc = await run("const big = Array.from({ length: 40 }, (_, i) => i);\n", {
      limits: { max_items: 5 },
    });
    const list = deref(last(doc), "big");
    assert.equal(list.items.length, 5);
    assert.equal(list.total, 40);
    assert.equal(list.truncated, true);
  });
});

describe("control flow", () => {
  it("nests recursive frames and reports each return value", async () => {
    const doc = await run(
      "function fact(n) { if (n <= 1) return 1; return n * fact(n - 1); }\nconst out = fact(4);\n",
    );
    const deepest = Math.max(...doc.steps.map((s) => s.frames.length));
    assert.equal(deepest, 5, "global + four fact frames");

    const returns = doc.steps.filter((s) => s.event === "return" && s.returned);
    assert.deepEqual(
      returns.map((s) => s.returned.prim).filter((v) => typeof v === "number"),
      [1, 2, 6, 24],
    );
    assert.equal(last(doc).frames[0].locals.out.prim, 24);
  });

  it("gives every recursive invocation its own frame id", async () => {
    const doc = await run(
      "function down(n) { if (n === 0) return 0; return down(n - 1); }\ndown(3);\n",
    );
    const deepest = doc.steps.reduce((a, b) => (b.frames.length > a.frames.length ? b : a));
    const ids = deepest.frames.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length, "frame ids must be unique within a stack");
  });

  it("traces a callback the standard library invokes", async () => {
    // The step loop refuses to walk through `map`, so this only works because
    // every user line also carries a breakpoint.
    const doc = await run("const xs = [1, 2, 3];\nconst out = xs.map(x => x * 2);\n");
    const inCallback = doc.steps.filter((s) => s.frames.length > 1);
    assert.ok(inCallback.length >= 3, "expected one pause per callback invocation");
    assert.deepEqual(deref(last(doc), "out").items.map((v) => v.prim), [2, 4, 6]);
  });
});

describe("output", () => {
  it("captures stdout and grows stdout_len with it", async () => {
    const doc = await run("console.log('one');\nconsole.log('two');\nconst end = 1;\n");
    assert.equal(doc.stdout, "one\ntwo\n");
    const lengths = doc.steps.map((s) => s.stdout_len);
    assert.deepEqual([...lengths].sort((a, b) => a - b), lengths, "must be monotonic");
    assert.equal(last(doc).stdout_len, doc.stdout.length);
  });

  it("folds console.error into the one output stream", async () => {
    const doc = await run("console.log('out');\nconsole.error('err');\nconst end = 1;\n");
    assert.match(doc.stdout, /out/);
    assert.match(doc.stdout, /err/);
  });

  it("never leaks the run directory into output", async () => {
    const doc = await run("console.log(__filename);\n");
    assert.ok(!doc.stdout.includes(os.tmpdir()), doc.stdout);
  });
});

describe("failure modes", () => {
  it("reports an uncaught throw with its type, message and line", async () => {
    const doc = await run("const a = 1;\nnull.boom();\nconst never = 2;\n");
    assert.equal(doc.status, "error");
    assert.equal(doc.error.type, "TypeError");
    assert.equal(doc.error.line, 2);
    assert.ok(doc.error.message.length > 0);
    assert.equal(last(doc).event, "exception");
    assert.ok(!last(doc).frames[0].order.includes("never"), "must stop at the throw");
  });

  it("reports a syntax error as a compile error, not a crash", async () => {
    const doc = await run("const = ;\n");
    assert.equal(doc.status, "compile_error");
    assert.equal(doc.steps.length, 0);
    assert.match(doc.error.type, /Error/);
    assert.ok(!JSON.stringify(doc.error).includes(os.tmpdir()), "path must not leak");
  });

  it("blames a syntax error on the user's line, not the module loader's", async () => {
    // The debugger's first stop for an unparseable snippet is inside Node's
    // loader. Reporting that frame would point the UI at a four-figure line
    // number in a file the reader has never seen.
    const doc = await run("const a = 1;\nconst b = ;\nconst c = 3;\n");
    assert.equal(doc.status, "compile_error");
    assert.equal(doc.error.line, 2);
    assert.ok(!/wrapSafe|wrapModuleLoad|internal\//.test(JSON.stringify(doc.error)),
      `internal frames leaked: ${JSON.stringify(doc.error)}`);
  });

  it("reports a syntax error in an ES module, which never pauses at all", async () => {
    // ESM fails while linking, before any frame exists, so the run produces no
    // steps and no exception -- which must not be read as a program that ran.
    const doc = await run('import fs from "node:fs";\nconst x = {;\n');
    assert.equal(doc.status, "compile_error");
    assert.match(doc.error.type, /Error/);
    assert.equal(doc.error.line, 2);
  });

  it("stops a runaway loop and returns the partial trace", async () => {
    const doc = await run("let i = 0;\nwhile (true) { i++; }\n", { limits: { max_steps: 40 } });
    assert.equal(doc.status, "truncated");
    assert.equal(doc.steps.length, 40);
    assert.equal(doc.limits.max_steps, 40);
  });

  it("survives a snippet that exits the process", async () => {
    const doc = await run("console.log('bye');\nprocess.exit(0);\n");
    assert.ok(["ok", "error"].includes(doc.status));
    assert.match(doc.stdout, /bye/);
  });
});

describe("typescript", () => {
  it("erases types and reports the original line numbers", async () => {
    const doc = await run(
      "interface Point { x: number }\n" +
      "const p: Point = { x: 1 };\n" +
      "function twice(n: number): number { return n * 2; }\n" +
      "const out: number = twice(p.x);\n",
      { language: "typescript" },
    );
    assert.equal(doc.status, "ok");
    assert.equal(doc.language, "typescript");
    // Line 1 is a type-only declaration and emits nothing to run.
    assert.ok(doc.steps.every((s) => s.line >= 2 && s.line <= 4), JSON.stringify(doc.steps.map((s) => s.line)));
    assert.equal(last(doc).frames[0].locals.out.prim, 2);
  });

  it("reports a type-annotation syntax error against the source line", async () => {
    const doc = await run("const a: = 1;\n", { language: "typescript" });
    assert.equal(doc.status, "compile_error");
    assert.equal(doc.error.line, 1);
  });

  it("keeps the submitted source, not the emitted JavaScript", async () => {
    const source = "const n: number = 1;\n";
    const doc = await run(source, { language: "typescript" });
    assert.equal(doc.source, source);
  });
});
