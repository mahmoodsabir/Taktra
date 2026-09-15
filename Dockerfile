# syntax=docker/dockerfile:1

# Pinned to the major the project requires (package.json engines: >=22.13).
ARG NODE_VERSION=22-slim

# ── build ─────────────────────────────────────────────────────────────────────
# Dependencies are installed inside the image rather than copied from a developer's
# machine. @duckdb/node-bindings is a platform-specific native module, so a macOS
# node_modules is unusable on a Linux server — the drift this image exists to end.
FROM node:${NODE_VERSION} AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY tsconfig.json ./
COPY src ./src

# `mastra build` bundles to .mastra/output and installs that bundle's own
# dependencies, so the output directory is self-contained.
RUN npm run build

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production

# Databases live here, on a mounted volume, never inside /app — a rebuilt image
# replaces /app wholesale.
ENV TURSO_DATABASE_URL=file:/data/mastra.db \
    DUCKDB_PATH=/data/mastra.duckdb \
    PORT=4111

WORKDIR /app
COPY --from=builder --chown=node:node /app/.mastra/output ./

RUN mkdir -p /data && chown -R node:node /data

# The agent runs arbitrary model output; it has no reason to be root.
USER node

EXPOSE 4111

# Confirms the HTTP server is accepting connections. It deliberately does not claim
# Telegram is reachable — polling recovers on its own and a network blip should not
# restart a healthy process.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('net').connect(Number(process.env.PORT||4111),'127.0.0.1').on('connect',function(){process.exit(0)}).on('error',function(){process.exit(1)})"

CMD ["node", "index.mjs"]
