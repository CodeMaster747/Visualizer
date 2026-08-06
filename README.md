# Visualizer

Watch code run, step by step. Upload a snippet, get every variable, object and
reference animated as it changes.

Python, Java, JavaScript and TypeScript. Unlike existing step-through
visualizers, this one supports **third-party libraries** (numpy, pandas,
scikit-learn, lodash), **user-defined classes**, and **uploaded sample
datasets**.

## Status

| Component | State |
|---|---|
| `schema/` — trace format v1 + validator | done |
| `frontend/` — landing page, sign-in, app shell (home, sidebar, settings) + replayer (code, stack, animated heap graph, timeline, narration) | done |
| `tracer-python/` — `sys.monitoring` tracer + FastAPI service | done, 37 tests |
| `tracer-java/` — JDI tracer + HTTP service | done, 15 tests |
| `tracer-node/` — V8 inspector tracer for JS + TS + HTTP service | done, 28 tests |
| `backend/` — Spring Boot orchestrator: cache, rate limit, Groq narration | done, 26 tests |
| `infra/` — Docker Compose, Caddy, gVisor + Oracle setup | done |
| Codebase-visualization section | not started (phase 2) |

Snippet visualization is complete for **Python, Java, JavaScript and
TypeScript**, deployable to a single VM. 140 tests pass across the six suites.

## Running it

### Everything at once (Docker)

```bash
cp .env.example .env      # optionally set GROQ_API_KEY for narration
docker compose up --build # http://localhost
```

The tracers run under `runc` locally; set `SANDBOX_RUNTIME=runsc` in production
once gVisor is installed (`infra/setup-oracle.sh`).

### Individual services (for development)

```bash
# Python tracer
cd tracer-python && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
VIZ_DATA_DIR=/tmp/viz-runs .venv/bin/python -m uvicorn app.main:app --port 8081

# Java tracer (needs a JDK, not a JRE — uses javax.tools + JDI)
cd tracer-java && mvn package && PORT=8082 java -jar target/tracer-java.jar

# JavaScript/TypeScript tracer (Node 22+)
cd tracer-node && npm install && PORT=8083 npm start

# Orchestrator
cd backend && VISUALIZER_TRACER_PYTHON=http://localhost:8081 \
  VISUALIZER_TRACER_JAVA=http://localhost:8082 \
  VISUALIZER_TRACER_NODE=http://localhost:8083 mvn spring-boot:run

# Frontend (proxies /api -> backend on 8080)
cd frontend && npm install && npm run dev   # http://localhost:5173
```

The root path is a landing page; **Get Started** leads to sign-in and sign-in
leads to the workspace under `/app`. From there open **Code snippet**, pick a
language and an example, then press **Visualize**. Uploaded files are read by
bare name (each run gets a private working directory). Requires Python 3.12+
(`sys.monitoring`), Java 21+ and Node 22+. A tracer that is not running is
shown disabled rather than hidden, so its absence is legible.

The **Codebase** section is a routed placeholder — phase 2, not built yet.

There is still no account *service*. Sign-in collects a name and an email,
stores them next to the preferences and recent runs already in this browser,
and asks for no password — so the workspace has a real session boundary
without any surface pretending there is a server behind it. `store/account.ts`
is the one file that changes when real auth arrives.

## Tests

```bash
cd tracer-python && .venv/bin/python -m pytest tests/ -q   # 37 — tracer + snapshotter
cd tracer-java   && mvn test                               # 15 — JDI tracer (launches JVMs)
cd tracer-node   && npm test                               # 28 — CDP tracer (launches node)
cd backend       && mvn test                               # 26 — cache, rate limit, narration
cd frontend      && npx vitest run                         # 34 — diff logic, routing, app shell
.venv-tools/bin/python schema/validate_fixtures.py         # fixtures vs schema
```

## How it works

**Execution and animation are fully decoupled.** Tracers emit a versioned JSON
*trace document*; the frontend is a pure replayer of it and knows nothing about
Python. Adding a language is a backend-only change, and playback is instantly
scrubbable rather than streamed.

### The trace format

`schema/trace-v1.schema.json`. A list of steps, each carrying the call stack and
the heap as of that moment.

The heap is a **graph, not a tree**: objects are id-keyed and variables hold
`{"ref": id}`. This is what makes aliasing (`a = b = [1,2]`) and cycles
(`a.next = b; b.next = a`) representable — a structural dump loses both, and
they are exactly what the tool exists to show.

`kind` is an open enum: rich types (`dataframe`, `ndarray`, `instance`) get
dedicated renderers, anything else falls back to a generic box. New types never
require a schema bump.

The replayer never branches on `language`, including when printing literals:
`meta.literals` carries how the source language spells null/true/false, because
"None" and "null" are the same value and only the tracer knows which word the
reader expects.

### Why libraries work here

The tracer uses `sys.monitoring` (PEP 669, Python 3.12+) rather than
`sys.settrace`. The decisive feature is `DISABLE`: a callback can permanently
retire a code location from monitoring. Every callback checks the filename and
returns `DISABLE` for anything that is not the user's snippet, so library
internals are dropped after their first hit and then run at full native speed —
while their resulting *objects* still appear in the heap snapshot.

Measured: `import pandas` + `read_csv` + `groupby` produces **8 steps in
~0.16s**. Tools that trace into library code produce millions of steps and are
unusable on the same input.

### Why Java works too

`tracer-java` uses **JDI** (the Java Debug Interface): it compiles the snippet
with `javax.tools`, launches it in a fresh debuggee JVM under debug control,
single-steps it, and snapshots the stack and heap at each line. The same
"don't step into libraries" principle applies — class exclusion filters keep the
stepper out of the JDK, and only user-class frames are recorded. A bare snippet
is auto-wrapped in a `Main` class; line numbers map back through the wrapper.

The output is the **identical trace-v1 document**, so the frontend replays a Java
run with zero changes. That is the payoff of decoupling execution from animation.

### Why JavaScript works too

`tracer-node` drives a debuggee `node --inspect-brk` process over the **V8
inspector protocol**, the same separate-process design as the Java tracer.

Staying out of the standard library is harder here. `Debugger.setBlackboxPatterns`
looks like the answer and does nothing: Node compiles its internals during
bootstrap, before the inspector attaches, so they are never matched against the
patterns — a single `console.log` drags a naive stepper through a dozen internal
frames. So the step loop never descends: the moment it lands outside the user's
file it steps straight back out, one round trip per library *call* rather than
per library *line*.

That rule alone would skip callbacks the library invokes (`xs.map(x => ...)`), so
every line of the snippet also carries a breakpoint. The step loop stays out of
the library; the breakpoints catch user code the library calls back into.

The heap snapshotter runs **inside** the debuggee rather than in the tracer,
because the protocol charges a round trip per object otherwise — walking a
twenty-node linked list would be twenty requests per step. One call per stack
frame returns the whole reachable graph, already in trace-v1 shape, with object
identity carried by a `WeakMap` so aliasing and cycles survive.

TypeScript is the same tracer: types are erased with `transpileModule` (never
type-checked — refusing to run code with a type error would refuse exactly the
code someone wants to watch), and executed lines are mapped back through the
source map so the UI highlights the line the user wrote.

### Narration (Groq)

The backend calls **Groq** (OpenAI-compatible API) to generate a one-sentence
explanation per step, in a single batched call over a downsampled trace — never
one call per step. It is:

- **separate** from `/trace`, so the visualization appears immediately and
  narration streams in after;
- **cached** by trace identity, and a *failed* narration is never cached (a
  transient outage must not permanently disable narration for a trace);
- **fail-soft** — no key, a timeout, or junk output just leaves the strip empty.

### Azure (optional)

Two integrations, each independently switched on by configuration and each
degrading to the previous behaviour when absent — see
[`infra/azure/README.md`](infra/azure/README.md) for setup.

- **Blob Storage** is a durable tier *behind* the Caffeine cache, not a
  replacement for it. The SHA-256 that already keys the cache becomes the blob
  name, so writes are idempotent and uploads are create-only (`If-None-Match:
  *`) — a re-run of the same snippet costs no write. What it buys is share
  links that survive a restart, which on a free instance that sleeps after 15
  minutes idle is the difference between a link working and not. Archive
  failures degrade to a cache miss and can never fail a run.
- **Entra External ID** replaces the local-profile sign-in with OIDC
  (authorization code + PKCE in the browser, JWT validation in Spring Security,
  audience checked as well as issuer). Rate limiting then keys on the token
  subject rather than the IP, so people behind one NAT stop sharing a bucket.

With neither configured the app is exactly what it was before: local sign-in,
in-memory cache, no Azure code path reached, full test suite green.

### Sandboxing

Traced code executes in the tracer's own process, so that process is treated as
compromised on every request:

- each Python request forks a child process, killed on timeout; each Java trace
  runs in a separate debuggee JVM, also killed on timeout
- containers run read-only, non-root, capped memory/pids, with a `noexec` tmpfs
- the tracers sit on a Docker **`internal` network with no internet route**, so
  untrusted code cannot phone home (verified: `urlopen` fails with `URLError`)
- in production they additionally run under **gVisor** — shared-kernel containers
  alone are not sufficient isolation for arbitrary user code

## Architecture

```
browser ── Caddy (TLS, static SPA, /api proxy)
              └─ backend  Spring Boot: cache, rate limit, Groq narration
                   ├─ tracer-python  FastAPI + sys.monitoring   ┐
                   ├─ tracer-java    JDI + javax.tools          │ gVisor,
                   └─ tracer-node    V8 inspector + tsc         ┘ no internet
```

## Layout

```
schema/          trace format, fixtures, validator
frontend/        React + TS replayer
  routes/          landing, login, home, snippet workspace, codebase,
                   profile, settings
  components/ui/   shared primitives (button, panel, controls, icons)
  components/shell/sidebar, account menu, page frame
  components/landing/ hero visuals, scroll reveal, footer
  lib/diff.ts      step-to-step change detection (drives the animation)
  lib/layout.ts    BFS column assignment + edge routing
  store/           playback state; selectors.ts holds memoized derived state
                   prefs + recents + account persist locally; session holds
                   the editor
tracer-python/
  app/tracer.py    sys.monitoring driver
  app/snapshot.py  heap snapshotter
tracer-java/
  .../JdiTracer.java   JDI stepping driver
  .../Snapshotter.java JDI value -> heap graph
  .../UserProgram.java compile + wrap
tracer-node/
  src/tracer.js        CDP stepping driver
  src/bootstrap.js     snapshotter, injected into the debuggee
  src/typescript.js    transpile + source-map line mapping
backend/
  .../trace/       orchestration, content-addressed cache
  .../llm/         Groq client + narration
  .../config/      rate limiting, beans
infra/           Caddyfile, Oracle + gVisor setup
docker-compose.yml
```
