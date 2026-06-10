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
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

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

# --- sqlite volume
RUN mkdir -p /data
VOLUME /data
ENV DATABASE_URL="file:///data/memory.db"

# --- app listens here
EXPOSE 3000

# Migrations are owned by the one-shot `migrate` compose service, which other
# services wait on (depends_on: service_completed_successfully). The image just
# runs its command.
CMD ["node", "dist/index.js"]
