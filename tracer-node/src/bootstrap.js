/**
 * The snapshotter, as source injected into the debuggee.
 *
 * It runs *inside* the traced process rather than in the tracer, because the
 * inspector protocol charges a round trip per object otherwise: walking a
 * linked list of twenty nodes would be twenty requests per step. Here one call
 * per stack frame returns the whole reachable graph already in trace-v1 shape.
 *
 * The rules are tracer-python's, restated for JavaScript:
 *
 * 1. Identity, not structure. Objects are keyed through a WeakMap so aliasing
 *    (`b = a`) and cycles (`a.next = a`) survive into the trace. A structural
 *    dump loses both, and they are exactly what the tool exists to show.
 * 2. Bounded output, honest truncation. Containers are capped and marked, so
 *    the UI can say "… 940 more" instead of silently lying.
 * 3. Never trust the object graph. Getters can throw, loop, or print, so this
 *    reads own property *descriptors* and only ever touches plain values.
 */

export function bootstrapSource(limits) {
  return `(() => {
const LIMITS = ${JSON.stringify(limits)};

const ids = new WeakMap();
let counter = 0;
const out = { text: "" };

function idFor(value) {
  let id = ids.get(value);
  if (id === undefined) { id = "o" + (++counter); ids.set(value, id); }
  return id;
}

function cut(text) {
  return text.length > LIMITS.max_string
    ? { text: text.slice(0, LIMITS.max_string), truncated: true }
    : { text, truncated: false };
}

function safeRepr(value, cap) {
  try {
    const text = typeof value === "function"
      ? "function " + (value.name || "(anonymous)")
      : String(value);
    return text.length > cap ? text.slice(0, cap) + "…" : text;
  } catch (err) {
    return "<unrepresentable>";
  }
}

/**
 * Primitives are inlined rather than given a heap id: numbers and strings have
 * no useful identity in JavaScript, so drawing a reference arrow to one would
 * teach the reader something false.
 *
 * \`undefined\` carries its own literal text so the replayer can tell it apart
 * from \`null\` without knowing which language produced the document.
 */
function encodePrimitive(value) {
  if (value === null) return { prim: null, prim_type: "null" };
  const type = typeof value;
  if (type === "undefined") return { prim: "undefined", prim_type: "null" };
  if (type === "boolean") return { prim: value, prim_type: "bool" };
  if (type === "number") {
    if (!Number.isFinite(value)) return { prim: String(value), prim_type: "float" };
    return Number.isInteger(value)
      ? { prim: value, prim_type: "int" }
      : { prim: value, prim_type: "float" };
  }
  if (type === "bigint") return { prim: String(value) + "n", prim_type: "int" };
  if (type === "string") {
    const c = cut(value);
    return c.truncated
      ? { prim: c.text, prim_type: "str", truncated: true }
      : { prim: c.text, prim_type: "str" };
  }
  return null;
}

function encode(value, heap, depth) {
  const primitive = encodePrimitive(value);
  if (primitive) return primitive;
  if (typeof value === "symbol") return { prim: safeRepr(value, 64), prim_type: "str" };

  const id = idFor(value);
  if (!(id in heap)) {
    // Reserve the slot BEFORE expanding: a cycle that reaches this object again
    // finds the key present and emits a plain ref instead of recursing forever.
    heap[id] = { kind: "pending" };
    heap[id] = expand(value, heap, depth);
  }
  return { ref: id };
}

function expand(value, heap, depth) {
  if (depth > LIMITS.max_depth) {
    return { kind: "elided", repr: safeRepr(value, 80), truncated: true };
  }
  try {
    return expandInner(value, heap, depth);
  } catch (err) {
    // A renderer failing must degrade to a generic box, never abort the trace.
    return { kind: "opaque", repr: "<snapshot failed: " + safeRepr(err && err.name, 40) + ">" };
  }
}

/** Own data properties only -- accessors are reported, never invoked. */
function ownEntries(value) {
  const out = [];
  for (const key of Object.getOwnPropertyNames(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d) continue;
    if ("value" in d) out.push([key, d.value]);
    else out.push([key, "<getter>"]);
  }
  return out;
}

function methodNames(proto) {
  const names = [];
  let current = proto;
  while (current && current !== Object.prototype && names.length < LIMITS.max_items) {
    for (const key of Object.getOwnPropertyNames(current)) {
      if (key === "constructor" || names.includes(key)) continue;
      const d = Object.getOwnPropertyDescriptor(current, key);
      if (d && typeof d.value === "function") names.push(key);
    }
    current = Object.getPrototypeOf(current);
  }
  return names;
}

function prototypeChain(value) {
  const chain = [];
  let current = Object.getPrototypeOf(value);
  while (current && chain.length < 6) {
    const name = current.constructor && current.constructor.name;
    chain.push(name || "Object");
    current = Object.getPrototypeOf(current);
  }
  return chain;
}

function expandInner(value, heap, depth) {
  const next = depth + 1;

  if (Array.isArray(value)) {
    const items = [];
    for (let i = 0; i < value.length && items.length < LIMITS.max_items; i++) {
      items.push(encode(value[i], heap, next));
    }
    return { kind: "list", items, total: value.length, truncated: value.length > items.length };
  }

  // Typed arrays are numeric grids, so they get the same renderer numpy does.
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const row = [];
    for (let i = 0; i < value.length && row.length < LIMITS.max_items; i++) {
      row.push(typeof value[i] === "bigint" ? Number(value[i]) : value[i]);
    }
    return {
      kind: "ndarray",
      dtype: value.constructor ? value.constructor.name : "TypedArray",
      shape: [value.length],
      preview: [row],
      truncated: value.length > row.length,
    };
  }

  if (value instanceof Map) {
    const entries = [];
    for (const [k, v] of value) {
      if (entries.length >= LIMITS.max_items) break;
      entries.push({ key: encode(k, heap, next), value: encode(v, heap, next) });
    }
    return { kind: "dict", entries, total: value.size, truncated: value.size > entries.length };
  }

  if (value instanceof Set) {
    const items = [];
    for (const v of value) {
      if (items.length >= LIMITS.max_items) break;
      items.push(encode(v, heap, next));
    }
    return { kind: "set", items, total: value.size, truncated: value.size > items.length };
  }

  if (value instanceof Date) return { kind: "date", repr: safeRepr(value.toISOString(), 64) };
  if (value instanceof RegExp) return { kind: "regexp", repr: safeRepr(value, 120) };
  if (value instanceof Error) {
    return { kind: "error", class: value.name || "Error", repr: safeRepr(value.message, 200) };
  }
  if (typeof Promise === "function" && value instanceof Promise) {
    return { kind: "promise", repr: "Promise" };
  }

  if (typeof value === "function") {
    // Not String(fn): a whole function body in a heap card buries everything
    // around it, and the name is the part the reader is tracking.
    const isClass = /^\\s*class[\\s{]/.test(Function.prototype.toString.call(value));
    if (isClass) {
      return {
        kind: "class",
        class: value.name || "(anonymous)",
        methods: methodNames(value.prototype),
        mro: prototypeChain(value.prototype || {}),
        repr: "class " + (value.name || "(anonymous)"),
      };
    }
    return { kind: "function", name: value.name || "(anonymous)", repr: "function " + (value.name || "(anonymous)") };
  }

  const proto = Object.getPrototypeOf(value);

  // A plain object is a bag of keys -- shown as one. A class instance has a
  // type the reader is thinking in terms of, so it keeps its name and methods.
  if (proto === Object.prototype || proto === null) {
    const all = ownEntries(value);
    const entries = [];
    for (const [key, v] of all.slice(0, LIMITS.max_items)) {
      entries.push({ key: { prim: key, prim_type: "str" }, value: encode(v, heap, next) });
    }
    return { kind: "dict", entries, total: all.length, truncated: all.length > entries.length };
  }

  const all = ownEntries(value);
  const fields = {};
  const order = [];
  for (const [key, v] of all.slice(0, LIMITS.max_items)) {
    order.push(key);
    fields[key] = encode(v, heap, next);
  }
  const className = (value.constructor && value.constructor.name) || "Object";
  return {
    kind: "instance",
    class: className,
    fields,
    field_order: order,
    methods: methodNames(proto),
    mro: prototypeChain(value),
    repr: className,
    truncated: all.length > order.length,
  };
}

// CommonJS wraps every module in a function, so these five live alongside the
// user's own top-level variables. They are machinery, not data.
const WRAPPER = new Set(["exports", "require", "module", "__filename", "__dirname"]);

/**
 * Snapshot one stack frame.
 *
 * Scopes arrive innermost-first (a \`for\` block before the function body), and
 * the first binding of a name wins, which is exactly JavaScript's shadowing.
 */
function snapshotScopes(scopes, skipWrapper) {
  const heap = {};
  const locals = {};
  const order = [];
  for (const scope of scopes) {
    if (!scope) continue;
    let names;
    try {
      names = Object.getOwnPropertyNames(scope);
    } catch (err) {
      continue;
    }
    for (const name of names) {
      if (name in locals) continue;
      if (skipWrapper && WRAPPER.has(name)) continue;
      if (name === "__viz") continue;
      let value;
      try {
        value = scope[name];
      } catch (err) {
        continue; // a variable in its temporal dead zone throws on read
      }
      order.push(name);
      locals[name] = encode(value, heap, 0);
    }
  }
  return { locals, order, heap, out_len: out.text.length };
}

/**
 * One output stream.
 *
 * stderr is folded into stdout so \`console.error\` still appears, in order,
 * in the one place the UI shows output -- and so a single counter describes
 * both. Writes still go through to the real stream, which is what the tracer
 * collects; this only counts them.
 */
function captureOutput() {
  const write = process.stdout.write.bind(process.stdout);
  const record = (chunk) => {
    out.text += typeof chunk === "string" ? chunk : String(chunk);
  };
  process.stdout.write = function (chunk, encoding, callback) {
    record(chunk);
    return write(chunk, encoding, callback);
  };
  process.stderr.write = function (chunk, encoding, callback) {
    record(chunk);
    return write(chunk, encoding, callback);
  };
}

captureOutput();

globalThis.__viz = {
  out,
  snapshotScopes,
  encodeValue(value) {
    const heap = {};
    return { value: encode(value, heap, 0), heap };
  },
};
return 1;
})()`;
}
