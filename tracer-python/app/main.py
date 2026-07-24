"""
Tracer HTTP service.

Intentionally tiny and stateless: one endpoint that turns source into a trace
document. It performs NO sandboxing of its own -- isolation is the container's
job (gVisor, no network, read-only rootfs, capped memory/pids). Putting the
security boundary in the same process as the code being traced would be
theatre, since traced code executes in this very interpreter.

This process is therefore assumed compromised on every request. It must be
disposable and hold nothing worth stealing.
"""

from __future__ import annotations

import multiprocessing as mp
import os
import queue
import shutil
import tempfile
from pathlib import Path

from fastapi import FastAPI
from pydantic import BaseModel, Field

from .limits import Limits
from .tracer import available_packages, trace

app = FastAPI(title="Visualizer Python Tracer", version="1.0")

# Base directory under which each request gets an isolated data subdir. In the
# container this is a tmpfs (noexec) mount; locally it falls back to the system
# temp dir so the service runs without a container.
RUN_ROOT = Path(os.environ.get("VIZ_DATA_DIR", tempfile.gettempdir()))

# Advertised to the UI so example snippets read files with the right style.
# User code always uses BARE FILENAMES (the child chdirs into its own data
# dir), which is what makes concurrent requests isolated from each other.
DATA_HINT = "the current directory"

# Hard ceiling regardless of what the caller asks for. The wall-clock limit
# inside the tracer stops loops in *Python*; this one also covers a C extension
# blocking with the interpreter lock held, where callbacks never fire.
HARD_TIMEOUT_S = 30


class SampleFile(BaseModel):
    name: str
    content: str


class TraceRequest(BaseModel):
    source: str = Field(max_length=200_000)
    stdin: str = Field(default="", max_length=100_000)
    files: list[SampleFile] = Field(default_factory=list)
    limits: dict | None = None


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "packages": available_packages(),
        "data_hint": DATA_HINT,
    }


def _write_sample_files(files: list[SampleFile], root: Path) -> list[str]:
    """
    Materialise uploaded datasets so `pd.read_csv("sales.csv")` works.

    Names are flattened to a basename: a name like "../../etc/passwd" must not
    escape the data directory, even though the sandbox would also stop it.
    """
    written = []
    for f in files:
        safe = Path(f.name).name
        if not safe or safe.startswith("."):
            continue
        (root / safe).write_text(f.content)
        written.append(safe)
    return written


def _worker(result: "mp.Queue", source: str, stdin: str, limits: Limits,
            data_dir: str) -> None:
    """
    Child-process entry point.

    Must be a module-level function, not a closure: Python 3.14 defaults to the
    `spawn` start method, which pickles the target, and closures are not
    picklable.

    chdir into the per-request data dir here rather than in the parent: the
    parent serves many requests concurrently on a threadpool, so a shared cwd
    would race. Each child owns its cwd, which is what makes uploaded files
    private to one run.
    """
    try:
        os.chdir(data_dir)
    except OSError:
        pass  # no sample data for this run; user code just will not find files
    try:
        result.put(trace(source, stdin, limits))
    except BaseException as exc:  # noqa: BLE001
        result.put({
            "version": 1, "language": "python", "status": "error",
            "source": source, "steps": [], "stdout": "",
            "error": {"type": type(exc).__name__, "message": str(exc)[:500]},
        })


def _run_in_subprocess(payload: TraceRequest, limits: Limits, data_dir: Path) -> dict:
    """
    Trace in a child process.

    Two reasons this cannot run inline: user code can call os._exit or segfault
    a C extension and take the server down with it, and a C call that blocks
    while holding the GIL is unreachable by the in-tracer timeout. A child can
    simply be killed.
    """
    result: mp.Queue = mp.Queue()
    proc = mp.Process(
        target=_worker,
        args=(result, payload.source, payload.stdin, limits, str(data_dir)),
        daemon=True,
    )
    proc.start()

    budget = min(limits.timeout_ms / 1000 + 10, HARD_TIMEOUT_S)
    try:
        # Drain the queue BEFORE join. A child that has put a large object will
        # not exit until the pipe is flushed, so joining first would deadlock.
        return result.get(timeout=budget)
    except queue.Empty:
        return {
            "version": 1, "language": "python", "status": "timeout",
            "source": payload.source, "steps": [], "stdout": "",
            "limits": limits.as_dict(),
            "error": {
                "type": "Timeout",
                "message": "Execution did not finish. This usually means a C-level "
                           "call blocked, which the step limiter cannot interrupt.",
            },
        }
    finally:
        if proc.is_alive():
            proc.kill()
        proc.join(timeout=2)


@app.post("/trace")
def create_trace(payload: TraceRequest) -> dict:
    limits = Limits.clamp(payload.limits)
    warnings: list[str] = []

    # A private data dir per request. Isolated by construction: no other run can
    # see or clobber these files, and it is deleted when the run finishes.
    RUN_ROOT.mkdir(parents=True, exist_ok=True)
    data_dir = Path(tempfile.mkdtemp(prefix="viz-run-", dir=RUN_ROOT))
    try:
        if payload.files:
            try:
                _write_sample_files(payload.files, data_dir)
            except OSError as exc:
                warnings.append(
                    f"Sample data could not be written: {exc.strerror}. "
                    f"Files will not be available to your code."
                )

        doc = _run_in_subprocess(payload, limits, data_dir)
    finally:
        shutil.rmtree(data_dir, ignore_errors=True)

    if warnings:
        doc.setdefault("meta", {})["warnings"] = warnings
    return doc
