/**
 * JavaScript / TypeScript tracer.
 *
 * Same shape as tracer-java: the snippet runs in a *separate* process under
 * debug control and this one drives it, so user code cannot take the service
 * down and a runaway loop is a `kill` away. There, the debugger is JDI; here it
 * is the V8 inspector over CDP.
 *
 * The hard problem is the same one every step-through tool has -- staying out
 * of the standard library. `Debugger.setBlackboxPatterns` does not help: Node
 * compiles its internals during bootstrap, before the inspector attaches, so
 * they are never re-evaluated against the patterns. One `console.log` will drag
 * a naive stepper through a dozen internal frames.
 *
 * So the loop below never descends. It steps into, and the moment it finds
 * itself outside the user's file it steps straight back out, which costs one
 * round trip per library call instead of one per library *line*. Callbacks
 * handed to library code (`xs.map(x => ...)`) would be skipped by that rule, so
 * every line of the snippet also carries a breakpoint: the step loop stays out
 * of the library, and the breakpoints catch user code the library calls back
 * into.
 */

import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { Cdp } from "./cdp.js";
import { bootstrapSource } from "./bootstrap.js";
import { PACKAGES_DIR, availablePackages } from "./packages.js";
import { transpile } from "./typescript.js";

/**
 * How the replayer should print `null`, `true` and `false` for this language.
 * Sent with the document so the UI never has to branch on which language
 * produced it -- "None" versus "null" is a fact about the source language, and
 * the tracer is the only party that knows it.
 */
const LITERALS = { null: "null", true: "true", false: "false" };

/** Scope kinds that hold the user's own bindings. `global` and `closure` are
 *  deliberately absent: one dumps the entire runtime, the other repeats a
 *  parent frame's variables inside every child. */
const USER_SCOPES = new Set(["local", "block", "catch", "module", "with"]);

const CONNECT_TIMEOUT_MS = 5000;

export async function trace({ source, language = "javascript", stdin = "", limits, dir }) {
  const started = Date.now();
  const program = prepare(source, language);
  if (program.error) {
    return document({ source, language, status: "compile_error", limits, started, error: program.error });
  }

  const entry = path.join(dir, program.filename);
  await writeFile(entry, program.code, "utf8");

  const child = spawn(process.execPath, ["--inspect-brk=127.0.0.1:0", entry], {
    cwd: dir,
    stdio: ["pipe", "pipe", "pipe"],
    // A curated environment, not the tracer's: traced code has no business
    // reading whatever happens to be exported into this process.
    env: {
      NODE_PATH: PACKAGES_DIR,
      NODE_NO_WARNINGS: "1",
      NO_COLOR: "1",
      PATH: "/usr/bin:/bin",
    },
  });

  const collected = { stdout: "", stderr: "" };
  child.stdout.on("data", (chunk) => { collected.stdout += chunk; });
  child.stderr.on("data", (chunk) => { collected.stderr += chunk; });
  child.on("error", () => { /* spawn failure surfaces as a missing ws url */ });
  if (stdin) child.stdin.write(stdin);
  child.stdin.end();

  const exited = new Promise((resolve) => child.on("exit", resolve));
  // "exit" can arrive with the last of stderr still in flight, and stderr is
  // where a parse error is reported. "close" is the event that means drained.
  const drained = new Promise((resolve) => child.on("close", resolve));
  let finished = false;
  exited.then(() => { finished = true; });

  const kill = () => { if (!child.killed) child.kill("SIGKILL"); };
  const deadline = started + limits.timeout_ms;
  const guard = setTimeout(kill, limits.timeout_ms + 2000);

  try {
    const wsUrl = await inspectorUrl(child, exited);
    if (!wsUrl) {
      // The process died before the debugger came up: almost always a syntax
      // error, which Node reports on stderr and nowhere else.
      return document({
        source, language, status: "compile_error", limits, started,
        stdout: clean(collected.stdout, dir),
        error: syntaxError(collected.stderr, dir, program.lineMap),
      });
    }

    const cdp = await Cdp.connect(wsUrl, CONNECT_TIMEOUT_MS);
    const run = await stepThrough({ cdp, child, exited, program, limits, deadline });
    cdp.close();
    // A run with no steps may still have something to say. Node holds a failing
    // module's report back until the inspector lets go ("Waiting for the
    // debugger to disconnect"), so killing here would destroy the only account
    // of why nothing ran. A run that did produce steps is killed at once, as
    // before -- that is what stops a runaway loop.
    if (run.steps.length === 0) {
      await Promise.race([drained, new Promise((r) => setTimeout(r, 1500))]);
    }
    kill();
    await exited;

    // A snippet that never parsed leaves no steps behind, whether the debugger
    // broke inside the loader (CommonJS) or never stopped at all (ESM, which
    // fails while linking, before any frame exists). Either way Node's own
    // report on stderr is the only account of what went wrong, and calling that
    // a successful run of nothing would be the worst answer available.
    const unparsed = run.steps.length === 0
      ? parseFailure(collected.stderr, dir, program.lineMap)
      : null;

    return document({
      source, language, limits, started,
      status: unparsed ? "compile_error" : run.status,
      steps: run.steps,
      stdout: clean(collected.stdout, dir),
      error: unparsed ?? run.error,
    });
  } finally {
    clearTimeout(guard);
    if (!finished) kill();
  }
}

/** Turn the submitted source into something Node can execute. */
function prepare(source, language) {
  if (language === "typescript") {
    const result = transpile(source);
    if (result.error) return result;
    return { filename: "main.js", code: result.code, lineMap: result.lineMap };
  }
  // ESM and CommonJS cannot be told apart by the file extension alone here, so
  // the syntax decides: `import`/`export` at the top level means a module.
  const esm = /^\s*(import|export)[\s{*]/m.test(source);
  return { filename: esm ? "main.mjs" : "main.js", code: source, lineMap: null };
}

/** Node announces the inspector on stderr; that line is the handshake. */
function inspectorUrl(child, exited) {
  return new Promise((resolve) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk;
      const match = buffer.match(/ws:\/\/\S+/);
      if (match) {
        child.stderr.off("data", onData);
        resolve(match[0]);
      }
    };
    child.stderr.on("data", onData);
    exited.then(() => resolve(null));
    setTimeout(() => resolve(null), CONNECT_TIMEOUT_MS);
  });
}

async function stepThrough({ cdp, child, exited, program, limits, deadline }) {
  const pauses = [];
  let waiting = null;
  let waitTimer = null;
  let ended = false;

  const deliver = (params) => {
    if (waiting) {
      clearTimeout(waitTimer);
      const resolve = waiting;
      waiting = null;
      resolve(params);
    } else if (params) {
      pauses.push(params);
    }
  };
  const finish = () => { ended = true; deliver(null); };

  cdp.on("Debugger.paused", deliver);
  cdp.on("__closed", finish);
  exited.then(finish);

  // `process.exit()` with an inspector attached does not exit: Node holds the
  // process open until the debugger disconnects, announcing it on stderr. That
  // line is the only signal that the program is over, and without it the run
  // sits here until the timeout and reports a hang that never happened.
  child.stderr.on("data", (chunk) => {
    if (String(chunk).includes("Waiting for the debugger to disconnect")) finish();
  });

  const nextPause = () => {
    if (pauses.length) return Promise.resolve(pauses.shift());
    if (cdp.closed || ended) return Promise.resolve(null);
    return new Promise((resolve) => {
      waiting = resolve;
      // Nothing may block past the deadline: a debuggee can wedge in a native
      // call where no pause will ever arrive.
      waitTimer = setTimeout(() => deliver(null), Math.max(0, deadline - Date.now()) + 500);
    });
  };

  const scripts = new Map();
  cdp.on("Debugger.scriptParsed", (p) => scripts.set(p.scriptId, p.url));

  await cdp.send("Runtime.enable");
  await cdp.send("Debugger.enable");
  await cdp.send("Debugger.setPauseOnExceptions", { state: "uncaught" });
  await cdp.send("Runtime.runIfWaitingForDebugger");

  const first = await nextPause();
  if (!first || !first.callFrames?.length) {
    return { status: "ok", steps: [] };
  }

  const scriptId = first.callFrames[0].location.scriptId;
  const url = scripts.get(scriptId) ?? "";

  // --inspect-brk normally stops on the snippet's first line. It stops somewhere
  // else in exactly one case: the snippet did not parse, so it was never entered
  // and what breaks instead is the SyntaxError being thrown inside Node's module
  // loader. Those are not the user's frames, and adopting their scriptId here
  // would report the loader's line numbers and internal function names as if
  // they were the snippet's. Hand it back to the stderr parser, which reads the
  // line out of Node's own report.
  if (!url.endsWith(program.filename)) {
    await cdp.send("Debugger.resume");
    return { status: "compile_error", steps: [], error: null, unparsed: true };
  }

  await cdp.send("Runtime.evaluate", {
    expression: bootstrapSource(limits),
    returnByValue: true,
    silent: true,
  });

  await setLineBreakpoints(cdp, url, program.code);

  const steps = [];
  const stack = [];      // one entry per live user frame, outermost first
  let frameCounter = 0;
  let error = null;
  let status = "ok";
  let paused = first;
  // Null until the first step: entering the module is not a "call" the reader
  // made, and tracer-python opens its traces on a `line` too.
  let previousDepth = null;

  while (paused) {
    if (Date.now() > deadline) { status = "timeout"; break; }
    if (steps.length >= limits.max_steps) { status = "truncated"; break; }

    const index = paused.callFrames.findIndex((f) => f.location.scriptId === scriptId);
    if (index === -1) {
      // Past the end of the snippet, or deep in machinery with nothing of ours
      // below. Let it run.
      await cdp.send("Debugger.resume");
      break;
    }
    if (index > 0) {
      // Inside a library call. Leave immediately rather than stepping through it.
      await cdp.send("Debugger.stepOut");
      paused = await nextPause();
      continue;
    }

    const userFrames = paused.callFrames.filter((f) => f.location.scriptId === scriptId);
    const top = userFrames[0];

    /**
     * The module's own return.
     *
     * Steps are recorded BEFORE their line runs, so the effect of the very last
     * statement is never captured by one. This is the only moment where the
     * program has finished but its frame is still alive, which makes it the
     * place to record the final state -- without it, `b.next = a` on the last
     * line appears to do nothing. tracer-python records the same step for the
     * same reason.
     */
    const isModuleReturn = userFrames.length === 1 && top.returnValue !== undefined;

    let line = mapLine(top.location.lineNumber + 1, program.lineMap);
    if (line === null) {
      // Compiler output, not the user's code -- unless it is the final state,
      // which is worth attributing to the last line the reader actually saw.
      if (!isModuleReturn) {
        await cdp.send("Debugger.stepInto");
        paused = await nextPause();
        continue;
      }
      line = steps.at(-1)?.line ?? 1;
    }

    const isException = paused.reason === "exception" || paused.reason === "promiseRejection";
    const event = isException ? "exception"
      : isModuleReturn ? "line"
        : top.returnValue !== undefined ? "return"
          : (previousDepth !== null && userFrames.length > previousDepth) ? "call"
            : "line";
    previousDepth = userFrames.length;

    const step = await snapshot({ cdp, userFrames, program, index: steps.length, line, event });
    // A module "returns" its exports object, which means nothing to the reader.
    if (top.returnValue !== undefined && !isModuleReturn) {
      const returned = await encodeRemote(cdp, top.returnValue, step.heap);
      if (returned) step.returned = returned;
    }
    steps.push(step);

    if (isException) {
      error = await describeThrown(cdp, paused.data, userFrames, program);
      status = "error";
      await cdp.send("Debugger.resume");
      break;
    }

    await cdp.send("Debugger.stepInto");
    paused = await nextPause();
  }

  // A module that fails to parse throws before a single statement runs. That is
  // a compile error, not a program that crashed, and calling it one lets the UI
  // point at the offending line instead of showing an empty trace.
  if (status === "error" && error?.type === "SyntaxError" && steps.length <= 1) {
    return { status: "compile_error", steps: [], error };
  }

  return { status, steps, error };

  /** Frame identity: minted on entry, retired on return, so a recursive call
   *  gets its own id and the UI can animate frames independently. */
  function syncStack(userFrames) {
    const outermostFirst = [...userFrames].reverse();
    while (stack.length > outermostFirst.length) stack.pop();
    outermostFirst.forEach((frame, i) => {
      const name = frame.functionName || "";
      if (!stack[i] || stack[i].name !== name) {
        stack[i] = { id: `f${++frameCounter}`, name };
      }
    });
    return outermostFirst;
  }

  async function snapshot({ cdp, userFrames, program, index, line, event }) {
    const outermostFirst = syncStack(userFrames);
    const heap = {};
    const frames = [];
    let outLen = null;

    for (let i = 0; i < outermostFirst.length; i++) {
      const frame = outermostFirst[i];
      const isModule = i === 0;
      const scopes = (frame.scopeChain ?? []).filter(
        (s) => USER_SCOPES.has(s.type) && s.object?.objectId,
      );
      const captured = await captureScopes(cdp, scopes, isModule);
      Object.assign(heap, captured.heap);
      if (captured.out_len !== null && captured.out_len !== undefined) outLen = captured.out_len;

      frames.push({
        id: stack[i].id,
        name: isModule ? "global" : (frame.functionName || "(anonymous)"),
        line: mapLine(frame.location.lineNumber + 1, program.lineMap) ?? line,
        locals: captured.locals,
        order: captured.order,
        ...(isModule ? { is_global: true } : {}),
      });
    }

    return {
      i: index,
      line,
      event,
      ...(outLen === null ? {} : { stdout_len: outLen }),
      frames,
      heap,
    };
  }
}

/**
 * A breakpoint on every line of the snippet.
 *
 * This is the net for user code that library code calls back into: the step
 * loop refuses to walk through `Array.prototype.map`, so without these the
 * callback body would never be seen. V8 resolves each request to the nearest
 * real statement and silently reports none for blank lines and comments.
 */
async function setLineBreakpoints(cdp, url, code) {
  if (!url) return;
  const lines = code.split("\n").length;
  for (let line = 0; line < lines; line++) {
    await cdp.send("Debugger.setBreakpointByUrl", { url, lineNumber: line, columnNumber: 0 })
      .catch(() => null);
  }
}

/** One round trip per frame: the debuggee walks the whole reachable graph. */
async function captureScopes(cdp, scopes, isModule) {
  const empty = { locals: {}, order: [], heap: {}, out_len: null };
  if (scopes.length === 0) return empty;
  const [first, ...rest] = scopes;
  const { result } = await cdp.send("Runtime.callFunctionOn", {
    objectId: first.object.objectId,
    functionDeclaration:
      "function () { const a = [...arguments]; const skip = a.pop(); " +
      "return __viz.snapshotScopes([this, ...a], skip); }",
    arguments: [...rest.map((s) => ({ objectId: s.object.objectId })), { value: isModule }],
    returnByValue: true,
    silent: true,
  });
  return result?.value ?? empty;
}

/**
 * Encode a value the inspector handed us as a RemoteObject.
 *
 * Primitives arrive complete and are encoded here; anything with an objectId is
 * handed back to the debuggee's encoder so there is one implementation of the
 * heap shape rather than two that can drift.
 */
async function encodeRemote(cdp, remote, heap) {
  if (!remote) return null;
  switch (remote.type) {
    case "undefined": return { prim: "undefined", prim_type: "null" };
    case "boolean": return { prim: remote.value, prim_type: "bool" };
    case "string": return { prim: String(remote.value), prim_type: "str" };
    case "bigint": return { prim: remote.unserializableValue ?? String(remote.value), prim_type: "int" };
    case "symbol": return { prim: remote.description ?? "Symbol()", prim_type: "str" };
    case "number": {
      if (remote.unserializableValue) {
        return { prim: remote.unserializableValue, prim_type: "float" };
      }
      return Number.isInteger(remote.value)
        ? { prim: remote.value, prim_type: "int" }
        : { prim: remote.value, prim_type: "float" };
    }
    default: break;
  }
  if (remote.subtype === "null") return { prim: null, prim_type: "null" };
  if (!remote.objectId) return null;

  const { result } = await cdp.send("Runtime.callFunctionOn", {
    objectId: remote.objectId,
    functionDeclaration: "function () { return __viz.encodeValue(this); }",
    returnByValue: true,
    silent: true,
  });
  if (!result?.value) return null;
  Object.assign(heap, result.value.heap);
  return result.value.value;
}

/** Build the error block for an uncaught throw. */
async function describeThrown(cdp, thrown, userFrames, program) {
  const top = userFrames[0];
  const error = {
    type: thrown?.className ?? "Error",
    message: "Uncaught",
    line: mapLine(top.location.lineNumber + 1, program.lineMap) ?? undefined,
    traceback: userFrames.map((f) => ({
      name: f.functionName || "global",
      line: mapLine(f.location.lineNumber + 1, program.lineMap) ?? 0,
    })).reverse(),
  };

  if (thrown?.objectId) {
    const { result } = await cdp.send("Runtime.callFunctionOn", {
      objectId: thrown.objectId,
      functionDeclaration:
        "function () { return { name: this && this.name, message: this && this.message }; }",
      returnByValue: true,
      silent: true,
    });
    if (result?.value) {
      error.type = result.value.name || error.type;
      error.message = String(result.value.message ?? "").slice(0, 500) || error.message;
    }
  } else if (thrown) {
    // `throw "a string"` is legal and depressingly common.
    error.type = "Thrown";
    error.message = String(thrown.description ?? thrown.value ?? "").slice(0, 500);
  }
  return error;
}

/** Generated line -> source line. Unmapped generated lines return null. */
function mapLine(line, lineMap) {
  if (!lineMap) return line;
  return lineMap.get(line) ?? null;
}

/**
 * Pull a syntax error out of Node's stderr.
 *
 * The report starts with an absolute path, which would leak the server's
 * filesystem layout into the UI, so the run directory is scrubbed everywhere
 * before anything is returned.
 */
function syntaxError(stderr, dir, lineMap) {
  const found = parseFailure(stderr, dir, lineMap);
  if (found) return found;
  const text = clean(stderr, dir);
  return {
    type: "SyntaxError",
    message: text.trim().split("\n")[0] || "The snippet could not be parsed.",
  };
}

/**
 * Node's report for a snippet that never parsed, or null if stderr holds no
 * such thing.
 *
 * A snippet can fail to parse without the debugger ever stopping in it, so
 * "no steps" alone cannot be read as "the program did nothing" -- the parse
 * error may be the only evidence anything happened, and it lives here.
 */
function parseFailure(stderr, dir, lineMap) {
  const text = clean(stderr, dir);
  const match = text.match(/^(\w*(?:Error|Exception)): (.*)$/m);
  const located = text.match(/^\S*main\.m?js:(\d+)/m);
  if (!match || !located) return null;
  const rawLine = Number(located[1]);
  return {
    type: match[1],
    message: match[2],
    line: mapLine(rawLine, lineMap) ?? rawLine,
  };
}

/** Strip the run directory and the inspector's own chatter. */
function clean(text, dir) {
  return text
    .split(dir + path.sep).join("")
    .split(dir).join("")
    .replace(/^Debugger listening on ws:\/\/\S+\r?\n?/gm, "")
    .replace(/^For help, see: https:\/\/nodejs\.org\/en\/docs\/inspector\r?\n?/gm, "")
    .replace(/^Debugger attached\.\r?\n?/gm, "")
    .replace(/^Waiting for the debugger to disconnect\.\.\.\r?\n?/gm, "");
}

function document({ source, language, status, limits, started, steps = [], stdout = "", error }) {
  // stdout_len is counted inside the debuggee; if it was killed mid-write the
  // parent may hold less text than the counter promises. Clamp rather than let
  // the UI slice past the end.
  for (const step of steps) {
    if (step.stdout_len === undefined) step.stdout_len = stdout.length;
    step.stdout_len = Math.min(step.stdout_len, stdout.length);
  }
  return {
    version: 1,
    language,
    status,
    source,
    steps,
    stdout,
    ...(error ? { error } : {}),
    limits,
    meta: {
      duration_ms: Date.now() - started,
      step_count: steps.length,
      runtime_version: process.versions.node,
      packages: availablePackages(),
      literals: LITERALS,
    },
  };
}
