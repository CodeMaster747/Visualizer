# Sandbox image for tracing untrusted JavaScript and TypeScript.
#
# The image IS the dependency set: there is no package manager at runtime and no
# network in the container, so a snippet can require exactly what is installed
# here and nothing else. Adding a library to the product means editing
# package.json and rebuilding this image.

FROM node:22-slim

WORKDIR /srv

# Runtime dependencies only: the TypeScript compiler, plus the curated modules
# snippets are allowed to require.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src/ ./src/

# NODE_PATH is how a snippet finds the curated modules: it runs in a private
# temp directory, so Node's own upward search would never reach /srv.
#
# VIZ_DATA_DIR points at the tmpfs the container mounts at /tmp, because the
# rootfs is read-only in production -- per-run files must land somewhere
# writable and ephemeral.
ENV NODE_ENV=production \
    NODE_PATH=/srv/node_modules \
    VIZ_PACKAGES_DIR=/srv/node_modules \
    VIZ_DATA_DIR=/tmp/runs \
    PORT=8083

# Traced code runs as this user, never root. Defence in depth: the container is
# also unprivileged, read-only, and on a no-internet network.
RUN useradd --create-home --uid 10001 tracer
USER tracer

EXPOSE 8083

# One process: each request already forks a debuggee, and extra workers would
# just multiply the blast radius.
CMD ["node", "src/main.js"]
