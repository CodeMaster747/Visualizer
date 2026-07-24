"""
Heap snapshotting.

Turns live Python objects into the id-keyed object graph the trace format
expects. This is the most delicate code in the project: it runs against
arbitrary user objects, so anything it touches may raise, block, or be
enormous. Every accessor here is defensive on purpose.

Design rules:

1. Identity, not structure. Objects are keyed by id() so aliasing (`a = b`)
   and cycles (a.next = b; b.next = a) survive into the trace. A structural
   dump would lose both, and they are exactly what the tool exists to show.

2. Bounded output, honest truncation. Every container is capped and marked
   `truncated` rather than silently cut, so the UI can say "... 940 more".

3. Never trust user objects. A __repr__ can raise, loop forever, or print.
   All of it is wrapped.
"""

from __future__ import annotations

import inspect
from typing import Any

from .limits import Limits

# Types inlined as primitives rather than given a heap id. Interning makes
# object identity meaningless for these, so a "reference" to one would be
# misleading -- `a = 5; b = 5` are the same object in CPython but users do not
# think of them that way.
PRIMITIVES = (int, float, bool, str, bytes, type(None))

PRIM_TYPE_NAMES = {
    int: "int",
    float: "float",
    bool: "bool",
    str: "str",
    type(None): "null",
}

SEQUENCE_KINDS = {
    list: "list",
    tuple: "tuple",
    set: "set",
    frozenset: "set",
}


def _safe_repr(obj: Any, limit: int) -> str:
    """repr() that cannot take the whole run down with it."""
    try:
        text = repr(obj)
    except Exception as exc:  # noqa: BLE001 - user __repr__ can raise anything
        return f"<unrepresentable: {type(exc).__name__}>"
    if len(text) > limit:
        return text[:limit] + "…"
    return text


def _type_name(obj: Any) -> str:
    try:
        return type(obj).__name__
    except Exception:  # noqa: BLE001
        return "object"


class Snapshotter:
    """
    Builds one heap snapshot per step.

    Object ids are stable for the lifetime of a run: the same list keeps the
    same "o7" across every step, which is what lets the UI animate a node
    rather than tear it down and rebuild it.
    """

    def __init__(self, limits: Limits) -> None:
        self.limits = limits
        self._ids: dict[int, str] = {}
        self._counter = 0
        # Holds a reference to every object we have named. Without this, an
        # object can be garbage collected mid-run and a NEW object can be
        # allocated at the same address -- id() would collide and two unrelated
        # values would render as the same node.
        self._pinned: list[Any] = []

    def _id_for(self, obj: Any) -> str:
        key = id(obj)
        if key not in self._ids:
            self._counter += 1
            self._ids[key] = f"o{self._counter}"
            self._pinned.append(obj)
        return self._ids[key]

    # -- value encoding ----------------------------------------------------

    def encode_value(self, obj: Any, heap: dict[str, dict]) -> dict:
        """
        Encode one slot. Primitives inline; everything else gets a heap id and
        is expanded into `heap` if not already there.
        """
        if isinstance(obj, bool):
            return {"prim": obj, "prim_type": "bool"}
        if obj is None:
            return {"prim": None, "prim_type": "null"}
        if isinstance(obj, int):
            # Python ints are unbounded; a 10000-digit int must not land in the
            # JSON payload verbatim.
            text = str(obj)
            if len(text) > self.limits.max_string:
                return {"prim": text[: self.limits.max_string], "prim_type": "int",
                        "truncated": True}
            return {"prim": obj, "prim_type": "int"}
        if isinstance(obj, float):
            # JSON cannot represent these; send them as strings so the UI can
            # still display "inf" instead of erroring on the whole document.
            if obj != obj or obj in (float("inf"), float("-inf")):
                return {"prim": repr(obj), "prim_type": "float"}
            return {"prim": obj, "prim_type": "float"}
        if isinstance(obj, str):
            if len(obj) > self.limits.max_string:
                return {"prim": obj[: self.limits.max_string], "prim_type": "str",
                        "truncated": True}
            return {"prim": obj, "prim_type": "str"}
        if isinstance(obj, bytes):
            return {"prim": _safe_repr(obj, self.limits.max_string), "prim_type": "str"}

        oid = self._id_for(obj)
        if oid not in heap:
            # Reserve the slot BEFORE expanding. A cycle that reaches this
            # object again will find the key present and emit a plain ref
            # instead of recursing forever.
            heap[oid] = {"kind": "pending"}
            heap[oid] = self._expand(obj, heap, depth=0)
        return {"ref": oid}

    # -- object expansion --------------------------------------------------

    def _expand(self, obj: Any, heap: dict[str, dict], depth: int) -> dict:
        if depth > self.limits.max_depth:
            return {"kind": "elided", "repr": _safe_repr(obj, 80), "truncated": True}

        try:
            return self._expand_inner(obj, heap, depth)
        except Exception as exc:  # noqa: BLE001
            # A renderer failing must degrade to a generic box, never abort the
            # whole trace.
            return {
                "kind": "opaque",
                "repr": f"<{_type_name(obj)}: snapshot failed ({type(exc).__name__})>",
            }

    def _expand_inner(self, obj: Any, heap: dict[str, dict], depth: int) -> dict:
        # --- rich types first; these are the whole point of the product ---
        rich = self._try_rich(obj, heap)
        if rich is not None:
            return rich

        # --- sequences ---
        for cls, kind in SEQUENCE_KINDS.items():
            if isinstance(obj, cls):
                return self._expand_sequence(obj, kind, heap, depth)

        if isinstance(obj, dict):
            return self._expand_dict(obj, heap, depth)

        # --- callables and modules ---
        if inspect.ismodule(obj):
            # Deliberately NOT repr(): that embeds the module's absolute path on
            # disk, which leaks the server's filesystem layout to the client and
            # turns a card the user does not care about into the biggest thing
            # in the heap pane.
            name = getattr(obj, "__name__", "?")
            return {"kind": "module", "name": name, "repr": f"<module '{name}'>"}

        if inspect.isclass(obj):
            return {
                "kind": "class",
                "class": obj.__name__,
                "methods": self._method_names(obj),
                "mro": [c.__name__ for c in getattr(obj, "__mro__", ())][: self.limits.max_items],
                "repr": f"<class {obj.__name__}>",
            }

        if inspect.isroutine(obj):
            # Not repr(): that appends a memory address, which is meaningless
            # noise to the reader and changes on every run, so two otherwise
            # identical traces would not compare equal.
            name = getattr(obj, "__name__", "λ")
            return {"kind": "function", "name": name, "repr": f"<function {name}>"}

        # --- user-defined instances ---
        state = self._instance_state(obj)
        if state is not None:
            fields: dict[str, dict] = {}
            order: list[str] = []
            for name, value in list(state.items())[: self.limits.max_items]:
                if name.startswith("__"):
                    continue
                order.append(name)
                fields[name] = self._encode_nested(value, heap, depth)
            return {
                "kind": "instance",
                "class": _type_name(obj),
                "fields": fields,
                "field_order": order,
                "methods": self._method_names(type(obj)),
                "mro": [c.__name__ for c in type(obj).__mro__][:6],
                "repr": _safe_repr(obj, 120),
                "truncated": len(state) > self.limits.max_items,
            }

        return {"kind": _type_name(obj), "repr": _safe_repr(obj, self.limits.max_string)}

    def _encode_nested(self, obj: Any, heap: dict[str, dict], depth: int) -> dict:
        """Like encode_value but carries depth, so nesting stays bounded."""
        if isinstance(obj, PRIMITIVES):
            return self.encode_value(obj, heap)
        oid = self._id_for(obj)
        if oid not in heap:
            heap[oid] = {"kind": "pending"}
            heap[oid] = self._expand(obj, heap, depth + 1)
        return {"ref": oid}

    def _expand_sequence(self, obj, kind: str, heap: dict[str, dict], depth: int) -> dict:
        try:
            total = len(obj)
        except Exception:  # noqa: BLE001
            total = 0
        items = []
        for i, element in enumerate(obj):
            if i >= self.limits.max_items:
                break
            items.append(self._encode_nested(element, heap, depth))
        return {
            "kind": kind,
            "items": items,
            "total": total,
            "truncated": total > len(items),
        }

    def _expand_dict(self, obj: dict, heap: dict[str, dict], depth: int) -> dict:
        entries = []
        for i, (key, value) in enumerate(obj.items()):
            if i >= self.limits.max_items:
                break
            entries.append({
                "key": self._encode_nested(key, heap, depth),
                "value": self._encode_nested(value, heap, depth),
            })
        return {
            "kind": "dict",
            "entries": entries,
            "total": len(obj),
            "truncated": len(obj) > len(entries),
        }

    def _method_names(self, cls: type) -> list[str]:
        try:
            names = [
                name
                for name, member in vars(cls).items()
                if callable(member) and not name.startswith("_")
            ]
            dunder = [n for n in vars(cls) if n in ("__init__", "__repr__", "__str__",
                                                    "__eq__", "__len__")]
            return (dunder + names)[: self.limits.max_items]
        except Exception:  # noqa: BLE001
            return []

    def _instance_state(self, obj: Any) -> dict[str, Any] | None:
        """__dict__, or __slots__ for classes that use them."""
        try:
            if hasattr(obj, "__dict__") and isinstance(obj.__dict__, dict):
                return dict(obj.__dict__)
        except Exception:  # noqa: BLE001
            return None
        try:
            slots = getattr(type(obj), "__slots__", None)
            if slots:
                names = [slots] if isinstance(slots, str) else list(slots)
                return {n: getattr(obj, n) for n in names if hasattr(obj, n)}
        except Exception:  # noqa: BLE001
            return None
        return None

    # -- rich library types -------------------------------------------------

    def _try_rich(self, obj: Any, heap: dict[str, dict]) -> dict | None:
        """
        Renderers for numpy/pandas values.

        Detection is by module+class name rather than isinstance, so this module
        never imports numpy or pandas. That keeps the tracer importable in a
        sandbox image that does not ship them, and avoids paying import cost for
        code that does not use them.
        """
        cls = type(obj)
        module = getattr(cls, "__module__", "") or ""
        name = cls.__name__
        root = module.split(".")[0]

        if root == "numpy" and name == "ndarray":
            return self._numpy_array(obj)
        if root == "pandas":
            if name == "DataFrame":
                return self._dataframe(obj)
            if name == "Series":
                return self._series(obj)
        return None

    def _numpy_array(self, arr: Any) -> dict:
        cap = min(self.limits.max_items, 12)
        try:
            shape = [int(d) for d in arr.shape]
            dtype = str(arr.dtype)
            view = arr[:cap] if arr.ndim >= 1 else arr

            if arr.ndim == 0:
                preview = [[arr.item()]]
            elif arr.ndim == 1:
                preview = [[self._cell(v) for v in view.tolist()]]
            else:
                preview = [
                    [self._cell(v) for v in row[:cap]]
                    for row in view.tolist()
                ]
            truncated = any(d > cap for d in shape)
            return {
                "kind": "ndarray", "shape": shape, "dtype": dtype,
                "preview": preview, "truncated": truncated,
                "repr": f"ndarray{tuple(shape)} {dtype}",
            }
        except Exception:  # noqa: BLE001
            return {"kind": "ndarray", "repr": _safe_repr(arr, 200)}

    def _dataframe(self, df: Any) -> dict:
        rows = min(self.limits.max_items, 15)
        cols = 12
        try:
            n_rows, n_cols = int(df.shape[0]), int(df.shape[1])
            head = df.iloc[:rows, :cols]
            columns = [str(c) for c in head.columns]
            return {
                "kind": "dataframe",
                "shape": [n_rows, n_cols],
                "columns": columns,
                "dtypes": {str(c): str(t) for c, t in head.dtypes.items()},
                "index": [self._cell(i) for i in head.index.tolist()],
                "preview": [[self._cell(v) for v in row] for row in head.values.tolist()],
                "truncated": n_rows > rows or n_cols > cols,
                "repr": f"DataFrame[{n_rows} rows x {n_cols} cols]",
            }
        except Exception:  # noqa: BLE001
            return {"kind": "dataframe", "repr": _safe_repr(df, 200)}

    def _series(self, series: Any) -> dict:
        rows = min(self.limits.max_items, 15)
        try:
            total = int(series.shape[0])
            head = series.iloc[:rows]
            return {
                "kind": "series",
                "shape": [total],
                "dtype": str(series.dtype),
                "name": str(series.name) if series.name is not None else None,
                "index": [self._cell(i) for i in head.index.tolist()],
                "preview": [
                    [self._cell(i), self._cell(v)]
                    for i, v in zip(head.index.tolist(), head.tolist())
                ],
                "truncated": total > rows,
                "repr": f"Series[{total}]",
            }
        except Exception:  # noqa: BLE001
            return {"kind": "series", "repr": _safe_repr(series, 200)}

    def _cell(self, value: Any) -> Any:
        """Coerce one table cell to something JSON can carry."""
        if isinstance(value, bool) or value is None:
            return value
        if isinstance(value, (int, str)):
            return value
        if isinstance(value, float):
            # NaN is pervasive in real dataframes and is not valid JSON.
            return None if value != value else value
        return _safe_repr(value, 60)

    # -- frames -------------------------------------------------------------

    def encode_frame(self, frame_id: str, frame: Any, heap: dict[str, dict],
                     is_global: bool) -> dict:
        locals_: dict[str, dict] = {}
        order: list[str] = []
        try:
            raw = dict(frame.f_locals)
        except Exception:  # noqa: BLE001
            raw = {}

        for name, value in raw.items():
            # Dunders and imported modules are noise in a teaching view.
            if name.startswith("__") and name.endswith("__"):
                continue
            if len(order) >= self.limits.max_items:
                break
            order.append(name)
            locals_[name] = self.encode_value(value, heap)

        return {
            "id": frame_id,
            "name": frame.f_code.co_name,
            "line": frame.f_lineno,
            "locals": locals_,
            "order": order,
            "is_global": is_global,
        }
