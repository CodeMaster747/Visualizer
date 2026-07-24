"""Execution and snapshot caps, surfaced in the trace so truncation is never silent."""

from __future__ import annotations

from dataclasses import dataclass, asdict


@dataclass(frozen=True)
class Limits:
    # Trace length. 5000 steps is roughly the point past which scrubbing stops
    # being a useful way to find anything.
    max_steps: int = 5000
    # Object graph depth from a frame variable.
    max_depth: int = 6
    # Elements per container, fields per instance, rows per table.
    max_items: int = 100
    # Characters per string, and digits per bignum.
    max_string: int = 512
    # Wall clock. Enforced by the tracer itself as well as by the sandbox, so a
    # runaway loop stops with a usable partial trace instead of a killed process.
    timeout_ms: int = 10_000

    def as_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def clamp(cls, raw: dict | None) -> "Limits":
        """
        Build limits from untrusted input.

        Every field is clamped: these values come from the client, and an
        unbounded max_steps is a trivial way to exhaust the box.
        """
        raw = raw or {}
        defaults = cls()

        def pick(key: str, low: int, high: int) -> int:
            value = raw.get(key, getattr(defaults, key))
            try:
                value = int(value)
            except (TypeError, ValueError):
                return getattr(defaults, key)
            return max(low, min(value, high))

        return cls(
            max_steps=pick("max_steps", 10, 20_000),
            max_depth=pick("max_depth", 1, 12),
            max_items=pick("max_items", 1, 500),
            max_string=pick("max_string", 16, 4_000),
            timeout_ms=pick("timeout_ms", 500, 20_000),
        )
