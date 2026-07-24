"""
Execution tracer built on sys.monitoring (PEP 669, Python 3.12+).

Why sys.monitoring rather than sys.settrace -- the two reasons this tool can do
things Python Tutor cannot:

1. Speed. settrace calls back into Python for every line of every frame,
   including library internals, and costs 10-100x. sys.monitoring instruments
   bytecode directly and is roughly an order of magnitude cheaper.

2. DISABLE. A callback can return sys.monitoring.DISABLE to permanently retire
   *that code location* from monitoring. We use it to skip library code after
   its first hit, so importing pandas costs a handful of callbacks total rather
   than millions. That is what makes `import pandas` viable at all, and it has
   no equivalent under settrace.

The result: user code is traced line by line, library code runs at full native
speed, and library *objects* still show up in the heap snapshot.
"""

from __future__ import annotations

import builtins
import io
import sys
import time
import traceback
from typing import Any

from .limits import Limits
from .snapshot import Snapshotter

MON = sys.monitoring
TOOL_ID = MON.DEBUGGER_ID

# Filename we compile user code under. Everything else is "library".
USER_FILE = "<snippet>"


class StepBudgetExceeded(Exception):
    """Raised inside user code to unwind once the step cap is hit."""


class Timeout(Exception):
    """Raised inside user code when the wall clock runs out."""


class Tracer:
    def __init__(self, source: str, limits: Limits) -> None:
        self.source = source
        self.limits = limits
        self.snapshotter = Snapshotter(limits)

        self.steps: list[dict] = []
        self.stdout = io.StringIO()
        self.error: dict | None = None
        self.status = "ok"

        self._frame_ids: dict[int, str] = {}
        self._frame_counter = 0
        self._deadline = 0.0
        self._stopping = False

    # -- frame identity -----------------------------------------------------

    def _frame_id(self, frame: Any) -> str:
        """
        Stable id per *invocation*.

        Recursion means several live frames share a function name, so the name
        alone is not enough -- without a per-invocation counter the UI cannot
        tell fact(4) from fact(3) and animates them as one box.
        """
        key = id(frame)
        existing = self._frame_ids.get(key)
        if existing is None:
            self._frame_counter += 1
            name = frame.f_code.co_name
            label = "global" if name == "<module>" else name
            existing = f"{label}#{self._frame_counter}"
            self._frame_ids[key] = existing
        return existing

    def _user_frames(self) -> list[Any]:
        """Live user frames, outermost first. Library frames are excluded."""
        out = []
        frame = sys._getframe()
        while frame is not None:
            if frame.f_code.co_filename == USER_FILE:
                out.append(frame)
            frame = frame.f_back
        out.reverse()
        return out

    # -- step recording -----------------------------------------------------

    def _record(self, event: str, line: int, returned: Any = None,
                has_return: bool = False) -> None:
        if self._stopping:
            return

        if len(self.steps) >= self.limits.max_steps:
            self.status = "truncated"
            self._stopping = True
            raise StepBudgetExceeded()

        if time.monotonic() > self._deadline:
            self.status = "timeout"
            self._stopping = True
            raise Timeout()

        frames_raw = self._user_frames()
        if not frames_raw:
            return

        heap: dict[str, dict] = {}
        frames = [
            self.snapshotter.encode_frame(
                self._frame_id(f), f, heap, is_global=(f.f_code.co_name == "<module>")
            )
            for f in frames_raw
        ]

        step = {
            "i": len(self.steps),
            "line": line,
            "event": event,
            "stdout_len": self.stdout.tell(),
            "frames": frames,
            "heap": heap,
        }
        if has_return:
            step["returned"] = self.snapshotter.encode_value(returned, heap)
        self.steps.append(step)

    # -- monitoring callbacks ----------------------------------------------
    #
    # Each returns MON.DISABLE for non-user code. That is the load-bearing
    # optimisation: the location is retired from monitoring permanently, so
    # library code costs one callback ever rather than one per execution.

    def _on_line(self, code, line_number: int):
        if code.co_filename != USER_FILE:
            return MON.DISABLE
        self._record("line", line_number)
        return None

    def _on_start(self, code, _offset: int):
        if code.co_filename != USER_FILE:
            return MON.DISABLE
        # The module frame's "call" is the program starting, which is noise.
        if code.co_name == "<module>":
            return None
        self._record("call", code.co_firstlineno)
        return None

    def _on_return(self, code, _offset: int, retval: Any):
        if code.co_filename != USER_FILE:
            return MON.DISABLE

        frames = self._user_frames()
        line = frames[-1].f_lineno if frames else code.co_firstlineno

        if code.co_name == "<module>":
            # LINE events fire BEFORE their line runs, so the effect of the very
            # last statement is never captured by one. The module's return is
            # the only moment where the program has finished but its frame is
            # still alive, so this is where the final state gets recorded --
            # without it, `b.next = a` on the last line appears to do nothing.
            self._record("line", line)
            return None

        self._record("return", line, returned=retval, has_return=True)
        return None

    def _on_raise(self, code, _offset: int, exc: BaseException):
        # RAISE does NOT support DISABLE -- PEP 669 allows it only for local
        # events (LINE, PY_START, PY_RETURN, CALL, ...). Returning DISABLE here
        # raises ValueError from inside the callback, which then masquerades as
        # the user's own exception and corrupts every error, timeout and
        # truncation result. Library raises are rare, so plain filtering costs
        # nothing measurable.
        if code.co_filename != USER_FILE:
            return None
        # Our own control-flow signals must not be recorded as user exceptions.
        if isinstance(exc, (StepBudgetExceeded, Timeout)):
            return None
        frames = self._user_frames()
        line = frames[-1].f_lineno if frames else code.co_firstlineno
        self._record("exception", line)
        return None

    # -- run ----------------------------------------------------------------

    def run(self, stdin: str = "") -> dict:
        compiled = self._compile()
        if compiled is None:
            return self.to_document()

        globals_: dict[str, Any] = {
            "__name__": "__main__",
            "__file__": USER_FILE,
            "__builtins__": builtins,
        }

        self._deadline = time.monotonic() + self.limits.timeout_ms / 1000
        started = time.monotonic()

        real_stdout, real_stderr, real_stdin = sys.stdout, sys.stderr, sys.stdin
        sys.stdout = self.stdout
        sys.stderr = self.stdout
        sys.stdin = io.StringIO(stdin)

        try:
            self._install()
            try:
                exec(compiled, globals_)
            except StepBudgetExceeded:
                pass  # status already set to "truncated"
            except Timeout:
                pass  # status already set to "timeout"
            except BaseException as exc:  # noqa: BLE001 - user code raises anything
                self._capture_error(exc)
        finally:
            self._uninstall()
            self._capture_figures()
            sys.stdout, sys.stderr, sys.stdin = real_stdout, real_stderr, real_stdin

        self.duration_ms = (time.monotonic() - started) * 1000
        return self.to_document()

    def _capture_figures(self) -> None:
        """
        Attach any matplotlib plot the user built to the final step.

        Detected via sys.modules rather than an import, so a run that never
        touches matplotlib pays nothing. The sandbox image forces the Agg
        backend (MPLBACKEND=Agg), so figures render to a buffer with no display.
        Only the highest-numbered (most recent) figure is attached -- the schema
        carries one figure per step and this is the plot the user is looking at.
        """
        if "matplotlib.pyplot" not in sys.modules or not self.steps:
            return
        try:
            import base64
            plt = sys.modules["matplotlib.pyplot"]
            nums = plt.get_fignums()
            if not nums:
                return
            fig = plt.figure(nums[-1])
            buf = io.BytesIO()
            fig.savefig(buf, format="png", dpi=90, bbox_inches="tight")
            self.steps[-1]["figure"] = base64.b64encode(buf.getvalue()).decode("ascii")
            plt.close("all")
        except Exception:  # noqa: BLE001 - a plotting failure must not lose the trace
            pass

    def _compile(self):
        try:
            return compile(self.source, USER_FILE, "exec")
        except SyntaxError as exc:
            self.status = "compile_error"
            self.error = {
                "type": "SyntaxError",
                "message": exc.msg or "invalid syntax",
                "line": exc.lineno or 1,
            }
            return None

    def _capture_error(self, exc: BaseException) -> None:
        self.status = "error"
        frames = [
            {"name": f.name, "line": f.lineno}
            for f in traceback.extract_tb(exc.__traceback__)
            if f.filename == USER_FILE
        ]
        self.error = {
            "type": type(exc).__name__,
            "message": str(exc)[: self.limits.max_string],
            "line": frames[-1]["line"] if frames else None,
            "traceback": frames,
        }

    def _install(self) -> None:
        MON.use_tool_id(TOOL_ID, "visualizer")
        events = MON.events
        MON.register_callback(TOOL_ID, events.LINE, self._on_line)
        MON.register_callback(TOOL_ID, events.PY_START, self._on_start)
        MON.register_callback(TOOL_ID, events.PY_RETURN, self._on_return)
        MON.register_callback(TOOL_ID, events.RAISE, self._on_raise)
        MON.set_events(
            TOOL_ID,
            events.LINE | events.PY_START | events.PY_RETURN | events.RAISE,
        )

    def _uninstall(self) -> None:
        try:
            MON.set_events(TOOL_ID, 0)
            for event in (MON.events.LINE, MON.events.PY_START,
                          MON.events.PY_RETURN, MON.events.RAISE):
                MON.register_callback(TOOL_ID, event, None)
            MON.free_tool_id(TOOL_ID)
        except Exception:  # noqa: BLE001
            # Never let teardown mask the user's actual result.
            pass

    # -- output -------------------------------------------------------------

    def to_document(self) -> dict:
        doc = {
            "version": 1,
            "language": "python",
            "status": self.status,
            "source": self.source,
            "steps": self.steps,
            "stdout": self.stdout.getvalue(),
            "limits": self.limits.as_dict(),
            "meta": {
                "step_count": len(self.steps),
                "duration_ms": round(getattr(self, "duration_ms", 0.0), 2),
                "runtime_version": (
                    f"{sys.version_info.major}.{sys.version_info.minor}"
                    f".{sys.version_info.micro}"
                ),
                "packages": available_packages(),
                # How Python spells these. The replayer must never branch on
                # `language`, and "None" vs "null" vs "nil" is the one place
                # where rendering a value depends on where it came from.
                "literals": {"null": "None", "true": "True", "false": "False"},
            },
        }
        if self.error:
            doc["error"] = self.error
        return doc


import importlib.util as _importlib_util

_DISPLAY_NAMES = {"sklearn": "scikit-learn"}
_KNOWN_PACKAGES = ("numpy", "pandas", "matplotlib", "scipy", "sklearn")
_available_cache: list[str] | None = None


def available_packages() -> list[str]:
    """
    Third-party packages present in the image, for display in the UI.

    Uses find_spec, NOT __import__: this runs inside to_document() on every
    trace, in a freshly spawned child where nothing is cached. Actually
    importing the scientific stack here added ~1-2s to every run, including
    `x = 1`. find_spec only checks that the module is importable.
    """
    global _available_cache
    if _available_cache is None:
        found = []
        for name in _KNOWN_PACKAGES:
            try:
                if _importlib_util.find_spec(name) is not None:
                    found.append(_DISPLAY_NAMES.get(name, name))
            except (ImportError, ValueError):
                pass
        _available_cache = found
    return _available_cache


def trace(source: str, stdin: str = "", limits: Limits | None = None) -> dict:
    return Tracer(source, limits or Limits()).run(stdin)
