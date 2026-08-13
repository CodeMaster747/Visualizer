# Frontend image: build the SPA, serve the static files with Caddy.
#
# Caddy also reverse-proxies /api to the backend, so the whole app is served
# same-origin and needs no CORS in production. The Caddyfile is bind-mounted by
# docker-compose (it lives in infra/ and cannot be COPYed from this build
# context, which is scoped to frontend/).

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# No build args. The SPA learns nothing about authentication at compile time --
# it posts to /api/auth and reads what comes back -- so this image is the same
# whatever the backend's auth settings are, and `docker compose restart` cannot
# leave it out of step with them.
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv
# /etc/caddy/Caddyfile is provided at runtime via a compose bind-mount.
