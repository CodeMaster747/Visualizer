#!/usr/bin/env python3
"""
Validates every fixture against trace-v1.schema.json.

This is the contract test for the trace format. Both tracers and the frontend
depend on this schema, so a fixture that fails here means the format is wrong,
not the fixture.

    .venv-tools/bin/python schema/validate_fixtures.py
"""

import json
import pathlib
import sys

from jsonschema import Draft202012Validator

ROOT = pathlib.Path(__file__).parent
SCHEMA = json.loads((ROOT / "trace-v1.schema.json").read_text())


def check_referential_integrity(doc, name, errors):
    """
    The schema cannot express this: every {"ref": id} must resolve to an object
    present in that same step's heap. A dangling ref renders as a broken arrow,
    which is the single most likely tracer bug, so we check it here.
    """
    for step in doc["steps"]:
        heap = step["heap"]
        seen = set()

        def walk(value, path):
            if not isinstance(value, dict):
                return
            if "ref" in value:
                seen.add(value["ref"])
                if value["ref"] not in heap:
                    errors.append(
                        f"{name} step {step['i']}: {path} -> dangling ref "
                        f"{value['ref']!r} not in heap"
                    )

        for frame in step["frames"]:
            for var, val in frame["locals"].items():
                walk(val, f"frame {frame['id']}.{var}")

        for oid, obj in heap.items():
            for item in obj.get("items", []):
                walk(item, f"{oid}.items")
            for entry in obj.get("entries", []):
                walk(entry["key"], f"{oid}.key")
                walk(entry["value"], f"{oid}.value")
            for fname, val in obj.get("fields", {}).items():
                walk(val, f"{oid}.{fname}")

        # Frame ids must be unique within a step or the UI keys collide and
        # React reuses the wrong DOM node during frame animations.
        ids = [f["id"] for f in step["frames"]]
        if len(ids) != len(set(ids)):
            errors.append(f"{name} step {step['i']}: duplicate frame ids {ids}")


def main():
    validator = Draft202012Validator(SCHEMA)
    errors = []
    files = sorted((ROOT / "fixtures").glob("*.json"))

    if not files:
        print("no fixtures found -- run build_fixtures.py first")
        return 1

    for path in files:
        doc = json.loads(path.read_text())
        name = path.stem
        for err in validator.iter_errors(doc):
            loc = "/".join(str(p) for p in err.absolute_path) or "<root>"
            errors.append(f"{name}: {loc}: {err.message}")
        check_referential_integrity(doc, name, errors)

        status = "FAIL" if any(e.startswith(name) for e in errors) else "ok"
        print(f"  [{status}] {name:12} {len(doc['steps']):3} steps")

    if errors:
        print(f"\n{len(errors)} problem(s):")
        for e in errors:
            print(f"  - {e}")
        return 1

    print(f"\nall {len(files)} fixtures valid against trace-v1")
    return 0


if __name__ == "__main__":
    sys.exit(main())
