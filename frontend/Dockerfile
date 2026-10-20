# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# VoucherHub frontend (React + Vite) production image.
#
# Builds the SPA to static files, then serves them with nginx (SPA fallback +
# /api proxy to the `server` container). Build context MUST be the repo root.
#
# `VITE_API_BASE_URL` is baked at build time; default keeps API calls same-origin
# (/api) so nginx can proxy them. Override with --build-arg for other setups.
# ─────────────────────────────────────────────────────────────────────────────

FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY package*.json ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY shared ./shared
COPY frontend ./frontend
RUN npm run build --workspace=shared && npm run build --workspace=frontend

# Runtime image runs as the unprivileged nginx user and listens on port 8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
