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

# Entra sign-in, baked in at build time because Vite resolves import.meta.env
# when it compiles rather than when it runs. Leave them unset and the SPA falls
# back to local-profile sign-in, which is what every build without a tenant
# does. None of the three is a secret: a public client has no client secret by
# design, which is the whole reason the browser uses PKCE.
ARG VITE_AZURE_CLIENT_ID=""
ARG VITE_AZURE_AUTHORITY=""
ARG VITE_AZURE_API_SCOPE=""
ENV VITE_AZURE_CLIENT_ID=$VITE_AZURE_CLIENT_ID \
    VITE_AZURE_AUTHORITY=$VITE_AZURE_AUTHORITY \
    VITE_AZURE_API_SCOPE=$VITE_AZURE_API_SCOPE

RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv
# /etc/caddy/Caddyfile is provided at runtime via a compose bind-mount.
