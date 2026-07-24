"""
Tracer behaviour tests.

The scenario list mirrors schema/fixtures/ deliberately: the fixtures define
what the frontend was built against, so the real tracer has to produce the same
shapes for those cases or the two halves have silently diverged.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from app.limits import Limits
from app.tracer import trace

SCHEMA_PATH = pathlib.Path(__file__).parents[2] / "schema" / "trace-v1.schema.json"


# --- helpers ---------------------------------------------------------------

def globals_of(step: dict) -> dict:
    return step["frames"][0]["locals"]


def final(doc: dict) -> dict:
    return doc["steps"][-1]


def kinds(step: dict) -> list[str]:
    return sorted(o["kind"] for o in step["heap"].values())


# --- core semantics --------------------------------------------------------

def test_primitive_assignment_is_inlined():
    doc = trace("x = 5\ny = 'hi'\nz = True\nw = None\n")
    loc = globals_of(final(doc))
    assert loc["x"] == {"prim": 5, "prim_type": "int"}
    assert loc["y"] == {"prim": "hi", "prim_type": "str"}
    assert loc["z"] == {"prim": True, "prim_type": "bool"}
    assert loc["w"] == {"prim": None, "prim_type": "null"}


def test_bool_is_not_reported_as_int():
    """bool subclasses int in Python; order of isinstance checks matters."""
    doc = trace("flag = True\n")
    assert globals_of(final(doc))["flag"]["prim_type"] == "bool"


def test_aliasing_shares_one_object_id():
    doc = trace("a = [1, 2, 3]\nb = a\nc = list(a)\na.append(4)\n")
    loc = globals_of(final(doc))
    assert loc["a"]["ref"] == loc["b"]["ref"], "a and b must share an id"
    assert loc["c"]["ref"] != loc["a"]["ref"], "c is a copy, not an alias"

    heap = final(doc)["heap"]
    assert len(heap[loc["a"]["ref"]]["items"]) == 4
    assert len(heap[loc["c"]["ref"]]["items"]) == 3


def test_last_statement_effect_is_captured():
    """
    LINE events fire before their line runs, so without an explicit final
    snapshot the last statement of a program appears to do nothing.
    """
    doc = trace("x = 1\nx = 2\nx = 3\n")
    assert globals_of(final(doc))["x"]["prim"] == 3


def test_recursion_gives_each_invocation_its_own_frame():
    doc = trace(
        "def fact(n):\n"
        "    if n <= 1:\n"
        "        return 1\n"
        "    return n * fact(n - 1)\n"
        "result = fact(4)\n"
    )
    deepest = max(doc["steps"], key=lambda s: len(s["frames"]))
    ids = [f["id"] for f in deepest["frames"]]
    assert len(ids) == len(set(ids)), "frame ids must be unique within a step"
    assert len(deepest["frames"]) == 5  # global + fact(4..1)
    ns = [f["locals"].get("n", {}).get("prim") for f in deepest["frames"][1:]]
    assert ns == [4, 3, 2, 1]
    assert globals_of(final(doc))["result"]["prim"] == 24


def test_return_events_carry_a_value():
    doc = trace("def f():\n    return 42\nx = f()\n")
    returns = [s for s in doc["steps"] if s["event"] == "return"]
    assert returns
    assert returns[-1]["returned"] == {"prim": 42, "prim_type": "int"}


def test_instance_fields_and_methods():
    doc = trace(
        "class Point:\n"
        "    def __init__(self, x, y):\n"
        "        self.x = x\n"
        "        self.y = y\n"
        "    def norm(self):\n"
        "        return self.x + self.y\n"
        "p = Point(3, 4)\n"
    )
    heap = final(doc)["heap"]
    inst = next(o for o in heap.values() if o["kind"] == "instance")
    assert inst["class"] == "Point"
    assert inst["fields"]["x"]["prim"] == 3
    assert "norm" in inst["methods"]
    assert inst["field_order"] == ["x", "y"]


def test_inheritance_shows_mro():
    doc = trace(
        "class Animal:\n"
        "    pass\n"
        "class Dog(Animal):\n"
        "    def __init__(self):\n"
        "        self.legs = 4\n"
        "d = Dog()\n"
    )
    inst = next(o for o in final(doc)["heap"].values() if o["kind"] == "instance")
    assert inst["mro"][:3] == ["Dog", "Animal", "object"]


def test_cyclic_structure_terminates_and_closes_the_loop():
    doc = trace(
        "class Node:\n"
        "    def __init__(self, v):\n"
        "        self.v = v\n"
        "        self.next = None\n"
        "a = Node(1)\n"
        "b = Node(2)\n"
        "a.next = b\n"
        "b.next = a\n"
    )
    loc = globals_of(final(doc))
    heap = final(doc)["heap"]
    a_id, b_id = loc["a"]["ref"], loc["b"]["ref"]
    assert heap[a_id]["fields"]["next"]["ref"] == b_id
    assert heap[b_id]["fields"]["next"]["ref"] == a_id


def test_self_reference_terminates():
    doc = trace("a = []\na.append(a)\n")
    loc = globals_of(final(doc))
    heap = final(doc)["heap"]
    assert heap[loc["a"]["ref"]]["items"][0]["ref"] == loc["a"]["ref"]


def test_dict_entries_preserve_order():
    doc = trace("d = {'b': 2, 'a': 1, 'c': 3}\n")
    obj = next(o for o in final(doc)["heap"].values() if o["kind"] == "dict")
    assert [e["key"]["prim"] for e in obj["entries"]] == ["b", "a", "c"]


def test_nested_containers():
    doc = trace("m = [[1, 2], [3, 4]]\n")
    assert kinds(final(doc)) == ["list", "list", "list"]


def test_stdout_is_cumulative_and_indexed_per_step():
    doc = trace("print('one')\nprint('two')\nprint('three')\n")
    assert doc["stdout"] == "one\ntwo\nthree\n"
    lengths = [s["stdout_len"] for s in doc["steps"]]
    assert lengths == sorted(lengths), "stdout_len must be non-decreasing"
    assert lengths[-1] == len(doc["stdout"])


def test_stdin_is_readable():
    doc = trace("name = input()\nprint('hi ' + name)\n", stdin="ada\n")
    assert doc["status"] == "ok"
    assert doc["stdout"] == "hi ada\n"


# --- failure modes ---------------------------------------------------------

def test_runtime_error_reports_type_line_and_traceback():
    doc = trace("def divide(a, b):\n    return a / b\nx = divide(10, 0)\n")
    assert doc["status"] == "error"
    assert doc["error"]["type"] == "ZeroDivisionError"
    assert doc["error"]["line"] == 2
    assert [f["line"] for f in doc["error"]["traceback"]] == [3, 2]
    assert doc["steps"][-1]["event"] == "exception"


def test_syntax_error_produces_a_valid_empty_trace():
    doc = trace("def broken(:\n    pass\n")
    assert doc["status"] == "compile_error"
    assert doc["error"]["type"] == "SyntaxError"
    assert doc["steps"] == []


def test_exception_raised_inside_a_library_is_still_attributed():
    doc = trace("import json\nx = json.loads('{bad')\n")
    assert doc["status"] == "error"
    assert doc["error"]["type"] == "JSONDecodeError"


def test_infinite_loop_times_out_with_a_partial_trace():
    doc = trace(
        "i = 0\nwhile True:\n    i += 1\n",
        limits=Limits(timeout_ms=700, max_steps=100_000_000),
    )
    assert doc["status"] == "timeout"
    assert len(doc["steps"]) > 0, "a timeout must still return what it saw"


def test_step_budget_truncates():
    doc = trace("for i in range(10000):\n    x = i\n", limits=Limits(max_steps=40))
    assert doc["status"] == "truncated"
    assert len(doc["steps"]) == 40


def test_long_string_is_truncated_and_flagged():
    doc = trace("s = 'x' * 100000\n", limits=Limits(max_string=100))
    value = globals_of(final(doc))["s"]
    assert len(value["prim"]) == 100
    assert value["truncated"] is True


def test_large_container_is_capped_but_reports_true_total():
    doc = trace("nums = list(range(5000))\n", limits=Limits(max_items=25))
    obj = next(o for o in final(doc)["heap"].values() if o["kind"] == "list")
    assert len(obj["items"]) == 25
    assert obj["total"] == 5000
    assert obj["truncated"] is True


def test_deep_nesting_is_elided_not_infinite():
    doc = trace("x = [[[[[[[[1]]]]]]]]\n", limits=Limits(max_depth=3))
    assert "elided" in kinds(final(doc))


def test_broken_repr_does_not_kill_the_trace():
    doc = trace(
        "class Evil:\n"
        "    def __repr__(self):\n"
        "        raise RuntimeError('boom')\n"
        "e = Evil()\n"
        "print('survived')\n"
    )
    assert doc["status"] == "ok"
    assert "survived" in doc["stdout"]


def test_nan_and_infinity_survive_json_encoding():
    doc = trace("a = float('nan')\nb = float('inf')\n")
    # json.dumps with allow_nan=False is what the API will use; bare NaN would
    # make the whole response unparseable in the browser.
    json.dumps(doc, allow_nan=False)


# --- performance / filtering ----------------------------------------------

def test_library_internals_do_not_generate_steps():
    """
    The core claim of the product: importing and using a library costs a
    handful of steps, not millions. This is what sys.monitoring's DISABLE buys
    us and it is why libraries are usable at all here.
    """
    doc = trace(
        "import json\n"
        "data = json.dumps({'a': [1, 2, 3], 'b': {'c': 4}})\n"
        "back = json.loads(data)\n"
    )
    assert doc["status"] == "ok"
    assert len(doc["steps"]) < 15, f"library code leaked into the trace: {len(doc['steps'])}"


def test_comprehensions_and_generators_are_traced():
    doc = trace("squares = [x * x for x in range(5)]\ntotal = sum(squares)\n")
    assert globals_of(final(doc))["total"]["prim"] == 30


def test_lambda_and_closure():
    doc = trace(
        "def make_adder(n):\n"
        "    return lambda x: x + n\n"
        "add5 = make_adder(5)\n"
        "result = add5(3)\n"
    )
    assert globals_of(final(doc))["result"]["prim"] == 8


# --- schema conformance ----------------------------------------------------

@pytest.mark.parametrize(
    "source",
    [
        "x = 1\n",
        "a = [1, 2]\nb = a\n",
        "class C:\n    def __init__(self):\n        self.v = 1\nc = C()\n",
        "def f(n):\n    return n\nx = f(2)\n",
        "x = 1 / 0\n",
    ],
    ids=["primitive", "alias", "instance", "call", "error"],
)
def test_output_validates_against_trace_v1(source):
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.loads(SCHEMA_PATH.read_text())
    doc = trace(source)
    jsonschema.Draft202012Validator(schema).validate(doc)


def test_every_ref_resolves_within_its_own_step():
    """A dangling ref renders as a broken arrow; it is the likeliest tracer bug."""
    doc = trace(
        "class N:\n"
        "    def __init__(self, v):\n"
        "        self.v = v\n"
        "        self.next = None\n"
        "a = N(1)\n"
        "b = N(2)\n"
        "a.next = b\n"
        "items = [a, b, {'k': a}]\n"
    )
    for step in doc["steps"]:
        heap = step["heap"]

        def check(value, where):
            if isinstance(value, dict) and "ref" in value:
                assert value["ref"] in heap, f"step {step['i']}: dangling {value['ref']} at {where}"

        for frame in step["frames"]:
            for name, value in frame["locals"].items():
                check(value, name)
        for oid, obj in heap.items():
            for item in obj.get("items", []):
                check(item, oid)
            for entry in obj.get("entries", []):
                check(entry["key"], oid)
                check(entry["value"], oid)
            for fname, value in (obj.get("fields") or {}).items():
                check(value, f"{oid}.{fname}")


def test_no_pending_placeholder_leaks_into_output():
    """The cycle guard writes a 'pending' sentinel; it must always be replaced."""
    doc = trace("a = []\na.append(a)\nb = {'self': a}\n")
    for step in doc["steps"]:
        assert "pending" not in kinds(step)


# --- rich rendering / plotting --------------------------------------------

def test_matplotlib_figure_is_attached_to_the_final_step():
    pytest.importorskip("matplotlib")
    doc = trace(
        "import matplotlib\n"
        "matplotlib.use('Agg')\n"
        "import matplotlib.pyplot as plt\n"
        "plt.plot([1, 2, 3], [1, 4, 9])\n"
    )
    assert doc["status"] == "ok"
    figure = doc["steps"][-1].get("figure")
    assert figure and len(figure) > 100, "expected a base64 PNG on the last step"


def test_no_matplotlib_import_means_no_figure_and_no_overhead():
    """A run that never plots must not pay for figure capture."""
    doc = trace("x = 1\n")
    assert all("figure" not in s for s in doc["steps"])


def test_available_packages_is_cached_and_fast():
    """
    find_spec, not __import__: this runs on every trace and must not import the
    scientific stack. Two calls must return the same cached list.
    """
    from app.tracer import available_packages

    first = available_packages()
    second = available_packages()
    assert first == second
    assert isinstance(first, list)
