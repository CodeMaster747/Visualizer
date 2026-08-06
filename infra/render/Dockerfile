# The whole stack as one image, for a 512 MB / 0.1 vCPU free host.
#
# docker-compose.yml is still the real deployment: five containers, per-service
# memory limits, and tracers on an `internal: true` network with no route to the
# internet. A free host gives you one container, so this file collapses that
# topology into a single process table (see infra/render/supervisord.conf) whose
# services talk over loopback.
#
# Read infra/render/README.md before pointing this at the public internet: the
# no-egress guarantee does not survive the collapse.
#
# Build context is the REPO ROOT, not this directory:
#     docker build -f infra/render/Dockerfile -t visualizer:single .

# --- the SPA ---------------------------------------------------------------
FROM node:22-bookworm-slim AS spa
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./

# Vite inlines import.meta.env at compile time, so Entra config has to arrive as
# build args rather than runtime environment. Render passes a service's
# environment variables to `docker build` as build args, so declaring them here
# is all that is needed; unset, the SPA uses local-profile sign-in. See
# infra/azure/README.md.
ARG VITE_AZURE_CLIENT_ID=""
ARG VITE_AZURE_AUTHORITY=""
ARG VITE_AZURE_API_SCOPE=""
ENV VITE_AZURE_CLIENT_ID=$VITE_AZURE_CLIENT_ID \
    VITE_AZURE_AUTHORITY=$VITE_AZURE_AUTHORITY \
    VITE_AZURE_API_SCOPE=$VITE_AZURE_API_SCOPE

RUN npm run build

# --- tracer-node's runtime dependencies ------------------------------------
FROM node:22-bookworm-slim AS nodedeps
WORKDIR /app
COPY tracer-node/package.json tracer-node/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# --- the two jars ----------------------------------------------------------
FROM maven:3.9-eclipse-temurin-21 AS jars
WORKDIR /build
COPY backend/pom.xml backend/
COPY tracer-java/pom.xml tracer-java/
RUN mvn -q -B -f backend/pom.xml dependency:go-offline \
 && mvn -q -B -f tracer-java/pom.xml dependency:go-offline
COPY backend/src backend/src
COPY tracer-java/src tracer-java/src
RUN mvn -q -B -f backend/pom.xml package -DskipTests \
 && mvn -q -B -f tracer-java/pom.xml package -DskipTests

# --- runtime ---------------------------------------------------------------
# Python is the base because it is the only one of the three runtimes that is
# painful to graft on; the JDK, node and caddy are all self-contained trees.
FROM python:3.13-slim-bookworm

# A full JDK, not a JRE: tracer-java needs javax.tools and JDI, and the backend
# is happy on the same one.
COPY --from=jars /opt/java/openjdk /opt/java/openjdk
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node

# The official caddy binary ships with cap_net_bind_service=ep so it can bind
# :80 as a non-root user. That file capability makes exec fail with EPERM on any
# runtime that drops the capability from the bounding set -- which is how Render
# runs containers, and why caddy died there with "couldn't exec caddy: EPERM"
# while starting fine under a stock Docker daemon. Nothing here needs it: caddy
# listens on $PORT (10000), well above 1024. Copying through `cat` writes a
# fresh inode and leaves the security.capability xattr behind.
COPY --from=caddy:2-alpine /usr/bin/caddy /usr/bin/caddy.setcap
RUN cat /usr/bin/caddy.setcap > /usr/bin/caddy \
 && rm /usr/bin/caddy.setcap \
 && chmod 0755 /usr/bin/caddy
ENV JAVA_HOME=/opt/java/openjdk \
    PATH="/opt/java/openjdk/bin:${PATH}"

WORKDIR /srv

# The image IS the dependency set: there is no package manager reachable at
# runtime, so a snippet can import exactly what is baked in here.
COPY tracer-python/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt supervisor \
 && rm requirements.txt

COPY tracer-python/app/ ./tracer-python/app/
COPY tracer-node/src/ ./tracer-node/src/
COPY --from=nodedeps /app/node_modules ./tracer-node/node_modules
COPY --from=jars /build/backend/target/visualizer-backend-*.jar ./backend.jar
COPY --from=jars /build/tracer-java/target/tracer-java.jar ./tracer-java.jar
COPY --from=spa /app/dist ./www
COPY infra/render/Caddyfile /etc/caddy/Caddyfile
COPY infra/render/supervisord.conf /etc/supervisord.conf

# Traced code runs as this user, never root.
RUN useradd --create-home --uid 10001 tracer \
 && mkdir -p /tmp/runs-python /tmp/runs-node \
 && chown -R tracer:tracer /tmp/runs-python /tmp/runs-node

ENV MPLBACKEND=Agg \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=10000

USER tracer
EXPOSE 10000

CMD ["supervisord", "-c", "/etc/supervisord.conf", "-n"]
