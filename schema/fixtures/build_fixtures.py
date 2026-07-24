#!/usr/bin/env python3
"""
Builds hand-authored fixture traces used to develop the frontend replayer
before any tracer exists.

These are written by hand (not captured from a real run) on purpose: they let us
pin down exactly the shapes the UI must handle -- aliasing, cycles, recursion,
rich tabular values -- and they stay stable while the real tracer churns.

    python3 schema/fixtures/build_fixtures.py
"""

import json
import pathlib

OUT = pathlib.Path(__file__).parent

LIMITS = {
    "max_steps": 5000,
    "max_depth": 6,
    "max_items": 100,
    "max_string": 512,
    "timeout_ms": 10000,
}


def prim(v, t):
    return {"prim": v, "prim_type": t}


def ref(i):
    return {"ref": i}


def doc(language, status, source, steps, stdout="", **kw):
    d = {
        "version": 1,
        "language": language,
        "status": status,
        "source": source,
        "steps": steps,
        "stdout": stdout,
        "limits": LIMITS,
        "meta": {"step_count": len(steps), **kw.pop("meta", {})},
    }
    d.update(kw)
    return d


# ---------------------------------------------------------------------------
# 1. Aliasing -- the case that separates a real heap graph from a tree renderer.
#    `a` and `b` point at the SAME list; mutating through `a` must visibly
#    change what `b` shows. `c` is a copy and must NOT change.
# ---------------------------------------------------------------------------

ALIASING_SRC = """a = [1, 2, 3]
b = a
c = list(a)
a.append(4)
b[0] = 99
print(a, b, c)
"""


def aliasing():
    def frame(locals_, order, line):
        return [{"id": "f0", "name": "<module>", "line": line,
                 "locals": locals_, "order": order, "is_global": True}]

    L = [prim(1, "int"), prim(2, "int"), prim(3, "int")]
    steps = []

    steps.append({
        "i": 0, "line": 1, "event": "line", "stdout_len": 0,
        "frames": frame({}, [], 1), "heap": {},
    })
    steps.append({
        "i": 1, "line": 2, "event": "line", "stdout_len": 0,
        "frames": frame({"a": ref("o1")}, ["a"], 2),
        "heap": {"o1": {"kind": "list", "items": list(L), "total": 3}},
    })
    # b = a  -> two names, ONE object id. The UI must draw two arrows into o1.
    steps.append({
        "i": 2, "line": 3, "event": "line", "stdout_len": 0,
        "frames": frame({"a": ref("o1"), "b": ref("o1")}, ["a", "b"], 3),
        "heap": {"o1": {"kind": "list", "items": list(L), "total": 3}},
    })
    # c = list(a) -> a genuinely separate object.
    steps.append({
        "i": 3, "line": 4, "event": "line", "stdout_len": 0,
        "frames": frame({"a": ref("o1"), "b": ref("o1"), "c": ref("o2")},
                        ["a", "b", "c"], 4),
        "heap": {
            "o1": {"kind": "list", "items": list(L), "total": 3},
            "o2": {"kind": "list", "items": list(L), "total": 3},
        },
    })
    L4 = L + [prim(4, "int")]
    steps.append({
        "i": 4, "line": 5, "event": "line", "stdout_len": 0,
        "frames": frame({"a": ref("o1"), "b": ref("o1"), "c": ref("o2")},
                        ["a", "b", "c"], 5),
        "heap": {
            "o1": {"kind": "list", "items": list(L4), "total": 4},
            "o2": {"kind": "list", "items": list(L), "total": 3},
        },
    })
    L5 = [prim(99, "int")] + L4[1:]
    steps.append({
        "i": 5, "line": 6, "event": "line", "stdout_len": 0,
        "frames": frame({"a": ref("o1"), "b": ref("o1"), "c": ref("o2")},
                        ["a", "b", "c"], 6),
        "heap": {
            "o1": {"kind": "list", "items": list(L5), "total": 4},
            "o2": {"kind": "list", "items": list(L), "total": 3},
        },
    })
    out = "[99, 2, 3, 4] [99, 2, 3, 4] [1, 2, 3]\n"
    steps.append({
        "i": 6, "line": 6, "event": "return", "stdout_len": len(out),
        "frames": frame({"a": ref("o1"), "b": ref("o1"), "c": ref("o2")},
                        ["a", "b", "c"], 6),
        "heap": {
            "o1": {"kind": "list", "items": list(L5), "total": 4},
            "o2": {"kind": "list", "items": list(L), "total": 3},
        },
    })
    return doc("python", "ok", ALIASING_SRC, steps, out)


# ---------------------------------------------------------------------------
# 2. Recursion -- multiple live frames of the same function. Frame ids must be
#    distinct per invocation or the UI cannot animate them independently.
# ---------------------------------------------------------------------------

FACT_SRC = """def fact(n):
    if n <= 1:
        return 1
    return n * fact(n - 1)

result = fact(4)
print(result)
"""


def recursion():
    steps = []
    i = 0

    def g(locals_, order, line):
        return {"id": "f0", "name": "<module>", "line": line,
                "locals": locals_, "order": order, "is_global": True}

    def push(line, frames, event="line", stdout_len=0, heap=None, **kw):
        nonlocal i
        s = {"i": i, "line": line, "event": event,
             "stdout_len": stdout_len, "frames": frames, "heap": heap or {}}
        s.update(kw)
        steps.append(s)
        i += 1

    glob = {"fact": ref("o1")}
    heap_fn = {"o1": {"kind": "function", "name": "fact", "repr": "<function fact>"}}

    # Line 1: `def fact` has not executed yet, so the name does not exist and
    # the heap is genuinely empty. From line 6 on, o1 must be present.
    push(1, [g({}, [], 1)])
    push(6, [g(dict(glob), ["fact"], 6)], heap=dict(heap_fn))

    # Descend: fact(4) -> fact(1)
    for depth, n in enumerate([4, 3, 2, 1], start=1):
        frames = [g(dict(glob), ["fact"], 6)]
        for d2, n2 in enumerate(list([4, 3, 2, 1])[:depth], start=1):
            frames.append({
                "id": f"fact#{d2}", "name": "fact",
                "line": 2 if n2 <= 1 else 4,
                "locals": {"n": prim(n2, "int")}, "order": ["n"],
            })
        s = {"i": i, "line": 2 if n <= 1 else 4,
             "event": "call", "stdout_len": 0, "frames": frames, "heap": dict(heap_fn)}
        steps.append(s); i += 1

    # Unwind: each return pops one frame and carries a value back.
    acc = 1
    for depth, n in reversed(list(enumerate([4, 3, 2, 1], start=1))):
        acc = acc if n == 1 else acc * n
        frames = [g(dict(glob), ["fact"], 6)]
        for d2, n2 in enumerate(list([4, 3, 2, 1])[:depth], start=1):
            frames.append({
                "id": f"fact#{d2}", "name": "fact", "line": 4,
                "locals": {"n": prim(n2, "int")}, "order": ["n"],
            })
        s = {"i": i, "line": 4, "event": "return", "stdout_len": 0,
             "frames": frames, "heap": dict(heap_fn),
             "returned": prim(acc, "int")}
        steps.append(s); i += 1

    out = "24\n"
    steps.append({
        "i": i, "line": 7, "event": "line", "stdout_len": len(out),
        "frames": [g({"fact": ref("o1"), "result": prim(24, "int")},
                     ["fact", "result"], 7)],
        "heap": dict(heap_fn),
    })
    return doc("python", "ok", FACT_SRC, steps, out)


# ---------------------------------------------------------------------------
# 3. Classes + a cyclic structure -- the two things Python Tutor clones break on.
#    node_a.next -> node_b, node_b.next -> node_a. A tree renderer infinite-loops
#    here; a graph renderer draws two nodes and two arrows.
# ---------------------------------------------------------------------------

NODE_SRC = """class Node:
    def __init__(self, value):
        self.value = value
        self.next = None

    def __repr__(self):
        return f"Node({self.value})"

a = Node("first")
b = Node("second")
a.next = b
b.next = a
"""


def cycle():
    steps = []
    cls = {
        "kind": "class", "class": "Node",
        "methods": ["__init__", "__repr__"],
        "mro": ["Node", "object"],
        "repr": "<class Node>",
    }

    def node(val, nxt):
        f = {"value": prim(val, "str")}
        f["next"] = ref(nxt) if nxt else {"prim": None, "prim_type": "null"}
        return {"kind": "instance", "class": "Node", "fields": f,
                "field_order": ["value", "next"], "repr": f"Node({val})"}

    def g(locals_, order, line):
        return [{"id": "f0", "name": "<module>", "line": line,
                 "locals": locals_, "order": order, "is_global": True}]

    steps.append({"i": 0, "line": 8, "event": "line", "stdout_len": 0,
                  "frames": g({"Node": ref("c1")}, ["Node"], 8),
                  "heap": {"c1": cls}})
    steps.append({"i": 1, "line": 9, "event": "line", "stdout_len": 0,
                  "frames": g({"Node": ref("c1"), "a": ref("o1")}, ["Node", "a"], 9),
                  "heap": {"c1": cls, "o1": node("first", None)}})
    steps.append({"i": 2, "line": 10, "event": "line", "stdout_len": 0,
                  "frames": g({"Node": ref("c1"), "a": ref("o1"), "b": ref("o2")},
                              ["Node", "a", "b"], 10),
                  "heap": {"c1": cls, "o1": node("first", None),
                           "o2": node("second", None)}})
    steps.append({"i": 3, "line": 11, "event": "line", "stdout_len": 0,
                  "frames": g({"Node": ref("c1"), "a": ref("o1"), "b": ref("o2")},
                              ["Node", "a", "b"], 11),
                  "heap": {"c1": cls, "o1": node("first", "o2"),
                           "o2": node("second", None)}})
    # The cycle closes here.
    steps.append({"i": 4, "line": 11, "event": "line", "stdout_len": 0,
                  "frames": g({"Node": ref("c1"), "a": ref("o1"), "b": ref("o2")},
                              ["Node", "a", "b"], 11),
                  "heap": {"c1": cls, "o1": node("first", "o2"),
                           "o2": node("second", "o1")}})
    return doc("python", "ok", NODE_SRC, steps)


# ---------------------------------------------------------------------------
# 4. pandas + numpy -- the headline "libraries actually work" case. Note the
#    library internals produce NO steps; only their resulting objects appear.
# ---------------------------------------------------------------------------

PANDAS_SRC = """import pandas as pd
import numpy as np

df = pd.read_csv("/data/sales.csv")
totals = df.groupby("region")["amount"].sum()
arr = np.array([[1, 2], [3, 4]])
print(totals)
"""


def dataframe():
    def g(locals_, order, line):
        return [{"id": "f0", "name": "<module>", "line": line,
                 "locals": locals_, "order": order, "is_global": True}]

    pd_mod = {"kind": "module", "name": "pandas", "repr": "<module 'pandas'>"}
    np_mod = {"kind": "module", "name": "numpy", "repr": "<module 'numpy'>"}

    df_obj = {
        "kind": "dataframe", "shape": [6, 3],
        "columns": ["region", "amount", "quarter"],
        "dtypes": {"region": "object", "amount": "int64", "quarter": "object"},
        "index": [0, 1, 2, 3, 4, 5],
        "preview": [
            ["north", 120, "Q1"], ["south", 340, "Q1"], ["north", 260, "Q2"],
            ["east", 90, "Q2"], ["south", 410, "Q3"], ["north", 175, "Q3"],
        ],
        "truncated": False,
        "repr": "DataFrame[6 rows x 3 cols]",
    }
    series = {
        "kind": "series", "shape": [3], "dtype": "int64",
        "name": "amount", "index": ["east", "north", "south"],
        "preview": [["east", 90], ["north", 555], ["south", 750]],
        "repr": "Series[3]",
    }
    arr = {
        "kind": "ndarray", "shape": [2, 2], "dtype": "int64",
        "preview": [[1, 2], [3, 4]], "repr": "array([[1, 2], [3, 4]])",
    }

    base = {"pd": ref("m1"), "np": ref("m2")}
    heap0 = {"m1": pd_mod, "m2": np_mod}
    steps = [
        {"i": 0, "line": 4, "event": "line", "stdout_len": 0,
         "frames": g(dict(base), ["pd", "np"], 4), "heap": dict(heap0)},
        {"i": 1, "line": 5, "event": "line", "stdout_len": 0,
         "frames": g({**base, "df": ref("o1")}, ["pd", "np", "df"], 5),
         "heap": {**heap0, "o1": df_obj}},
        {"i": 2, "line": 6, "event": "line", "stdout_len": 0,
         "frames": g({**base, "df": ref("o1"), "totals": ref("o2")},
                     ["pd", "np", "df", "totals"], 6),
         "heap": {**heap0, "o1": df_obj, "o2": series}},
        {"i": 3, "line": 7, "event": "line", "stdout_len": 0,
         "frames": g({**base, "df": ref("o1"), "totals": ref("o2"), "arr": ref("o3")},
                     ["pd", "np", "df", "totals", "arr"], 7),
         "heap": {**heap0, "o1": df_obj, "o2": series, "o3": arr}},
    ]
    out = "region\neast      90\nnorth    555\nsouth    750\nName: amount, dtype: int64\n"
    steps.append({
        "i": 4, "line": 7, "event": "return", "stdout_len": len(out),
        "frames": steps[-1]["frames"], "heap": steps[-1]["heap"],
    })
    d = doc("python", "ok", PANDAS_SRC, steps, out)
    d["meta"]["packages"] = ["numpy", "pandas", "matplotlib", "scipy", "scikit-learn"]
    return d


# ---------------------------------------------------------------------------
# 5. Runtime error -- the trace is still valid and replayable up to the throw.
# ---------------------------------------------------------------------------

ERR_SRC = """def divide(a, b):
    return a / b

x = divide(10, 0)
"""


def error_case():
    def g(locals_, order, line):
        return {"id": "f0", "name": "<module>", "line": line,
                "locals": locals_, "order": order, "is_global": True}

    fn = {"o1": {"kind": "function", "name": "divide", "repr": "<function divide>"}}
    glob = {"divide": ref("o1")}
    call_frame = {"id": "divide#1", "name": "divide", "line": 2,
                  "locals": {"a": prim(10, "int"), "b": prim(0, "int")},
                  "order": ["a", "b"]}
    steps = [
        {"i": 0, "line": 4, "event": "line", "stdout_len": 0,
         "frames": [g(dict(glob), ["divide"], 4)], "heap": dict(fn)},
        {"i": 1, "line": 2, "event": "call", "stdout_len": 0,
         "frames": [g(dict(glob), ["divide"], 4), dict(call_frame)], "heap": dict(fn)},
        {"i": 2, "line": 2, "event": "exception", "stdout_len": 0,
         "frames": [g(dict(glob), ["divide"], 4), dict(call_frame)], "heap": dict(fn)},
    ]
    return doc("python", "error", ERR_SRC, steps, "", error={
        "type": "ZeroDivisionError",
        "message": "division by zero",
        "line": 2,
        "traceback": [{"name": "<module>", "line": 4}, {"name": "divide", "line": 2}],
    })


FIXTURES = {
    "aliasing": aliasing,
    "recursion": recursion,
    "cycle": cycle,
    "dataframe": dataframe,
    "error": error_case,
}


def main():
    for name, fn in FIXTURES.items():
        path = OUT / f"{name}.json"
        path.write_text(json.dumps(fn(), indent=2) + "\n")
        print(f"wrote {path.relative_to(OUT.parent.parent)}")


if __name__ == "__main__":
    main()
