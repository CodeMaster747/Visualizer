# Sandbox image for tracing untrusted Python.
#
# The image IS the dependency set: there is no pip at runtime and no network in
# the container, so user code can import exactly what is baked in here and
# nothing else. Adding a library to the product means rebuilding this image.

FROM python:3.13-slim

# Build deps for the scientific stack, removed again in the same layer so they
# do not survive into the shipped image.
RUN apt-get update && apt-get install -y --no-install-recommends \
      gcc g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y gcc g++ && apt-get autoremove -y

COPY app/ ./app/

# Headless matplotlib: without this, importing pyplot tries to find a display
# and hangs inside a container with no X server.
#
# VIZ_DATA_DIR points at the tmpfs the container mounts at /tmp, because the
# rootfs is read-only in production -- per-run sample data must land somewhere
# writable and ephemeral.
ENV MPLBACKEND=Agg \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIZ_DATA_DIR=/tmp/runs

# Traced code runs as this user, never root. Defence in depth: the container is
# also unprivileged, read-only, and on a no-internet network.
RUN useradd --create-home --uid 10001 tracer
USER tracer

EXPOSE 8081

# Single worker: each request already forks a child process to run user code,
# and extra workers would just multiply the blast radius.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8081", "--workers", "1"]
