# Single-container deployment (Render free tier)

`docker-compose.yml` in the repo root is the real deployment. This directory is
a compromise build for hosts that give you **one container and 512 MB**, which
is what the free tiers that do not ask for a payment card still offer.

## What changes

| | compose (a VM) | here (one free container) |
|---|---|---|
| Processes | 5 containers | 5 processes under supervisor |
| Service discovery | Docker DNS (`tracer-java:8082`) | loopback (`127.0.0.1:8082`) |
| Per-service memory caps | yes, per container | JVM `-Xmx` flags only |
| Read-only rootfs, `cap_drop: ALL` | yes | no — one shared container |
| gVisor (`runsc`) | yes in production | not available |
| **Tracers have no internet route** | **yes, enforced by the network** | **no** |

The first four are degradations. The last one is a change in kind, and it is
the reason this file exists.

## The egress problem

The compose deployment puts the tracers on a Docker network declared
`internal: true`. Untrusted code cannot reach the internet from there, and the
README's claim about that is verified — `urlopen` fails with `URLError`.

A single container has one network interface and it is the same one Render
needs to serve traffic. There is no way to keep the HTTP listener reachable and
the tracers isolated, and Render does not grant `NET_ADMIN`, so it cannot be
fixed with iptables from inside the container either.

**So on this deployment, a snippet submitted by a visitor can make outbound
network requests.** What survives is the per-run isolation: each Python request
forks a child that is killed on timeout, each Java trace runs in a separate
debuggee JVM that is killed on timeout, every process runs as uid 10001, and
heaps are capped. That stops runaway code. It does not stop deliberate abuse of
a public URL.

Treat a public deployment of this image as an accepted risk, not as the
sandboxed design the compose file implements.

## The memory budget

Free instances are 512 MB. Measured peaks for the compose stack, under a
scikit-learn trace and a Java trace with a live debuggee JVM:

    backend         178 MB      tracer-node      73 MB
    tracer-python   126 MB      tracer-java      66 MB
    caddy            16 MB      -> ~460 MB total

That is inside 512 MB with nothing to spare, and both JVMs default to sizing
their heap from *total container* memory — two of them would claim half the
budget between them before a single trace ran. So `supervisord.conf` caps every
heap explicitly: 128 MB for the backend, 80 MB for the Java tracer, 64 MB for
each debuggee JVM it forks, 96 MB for node. That brings the idle baseline to
roughly 300 MB and leaves headroom for one trace at a time.

One trace at a time is the real limit here. Concurrent users on a 0.1 vCPU
instance will be slow before they are anything else.

## Building it locally

Build context is the repository root:

```bash
docker build -f infra/render/Dockerfile -t visualizer:single .

# Reproduce the free tier's limits exactly before trusting them
docker run --rm -p 10000:10000 -m 512m --cpus 0.1 \
  -e GROQ_API_KEY="$GROQ_API_KEY" visualizer:single
```

Then `curl localhost:10000/api/health`. If that reports all four languages
`true` under those flags, it will run on the free tier.
