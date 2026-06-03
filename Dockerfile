# syntax=docker/dockerfile:1

# --------------------------------------------------------
# Build-once, run-anywhere Dockerfile for Fly.io / Node.js
# --------------------------------------------------------
# 1) Builds TypeScript → plain JS during image build
# 2) Prunes dev-dependencies ➜ tiny production image
# 3) Runs pre-compiled JS
# --------------------------------------------------------

ARG NODE_VERSION=24.13.0-trixie

########################  Base image  ########################
FROM node:${NODE_VERSION}-slim AS base
LABEL fly_launch_runtime="Node.js"
WORKDIR /app
ENV NODE_ENV=production

########################  Dependencies  ######################
FROM base AS deps
ENV NODE_ENV=development

# --- tooling required to compile native deps & build sources
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3 && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@11.4.0

# --- install *all* deps (dev+prod) so that TS/Rspack can compile
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

########################  Build stage  #######################
FROM deps AS build

# --- copy sources & transpile to dist
COPY . .
RUN pnpm build

# --- drop dev-deps to shrink final layer
RUN pnpm prune --prod

#######################  Runtime stage  ######################
FROM base AS runtime

# --- copy only pruned node_modules + built app
COPY --from=build /app /app

# --- create entrypoint script
RUN echo '#!/bin/sh\n\
# Check if database and migrations table exist\n\
if [ ! -f /data/memory.db ] || ! node dist/migrate.js check 2>/dev/null; then\n\
  echo "Running migrations..."\n\
  node dist/migrate.js up\n\
else\n\
  echo "Migrations already applied, skipping"\n\
fi\n\
\n\
echo "Starting application..."\n\
exec node dist/index.js\n\
' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# --- sqlite volume
RUN mkdir -p /data
VOLUME /data
ENV DATABASE_URL="file:///data/memory.db"

# --- app listens here
EXPOSE 3000

# --- launch: entrypoint script
CMD ["/app/entrypoint.sh"]
