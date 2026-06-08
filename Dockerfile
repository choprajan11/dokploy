# syntax=docker/dockerfile:1
FROM node:24.4.0-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN corepack prepare pnpm@10.22.0 --activate

FROM base AS build
COPY . /usr/src/app
WORKDIR /usr/src/app

RUN apt-get update && apt-get install -y python3 make g++ git python3-pip pkg-config libsecret-1-dev && rm -rf /var/lib/apt/lists/*

# Install dependencies
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Deploy only the dokploy app

ENV NODE_ENV=production
RUN pnpm --filter=@dokploy/server build
RUN pnpm --filter=./apps/dokploy run build

RUN pnpm --filter=./apps/dokploy --prod deploy --legacy /prod/dokploy

RUN cp -R /usr/src/app/apps/dokploy/.next /prod/dokploy/.next
RUN cp -R /usr/src/app/apps/dokploy/dist /prod/dokploy/dist

FROM base AS dokploy
WORKDIR /app

# Set production
ENV NODE_ENV=production

# Install system tools BEFORE copying app code so these heavy layers stay
# cached even when source files change (only the COPY layers below get
# invalidated on a code-only rebuild).
RUN apt-get update && apt-get install -y curl unzip zip apache2-utils iproute2 rsync git-lfs && git lfs install && rm -rf /var/lib/apt/lists/*

# Install docker
RUN curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh --version 28.5.2 && rm get-docker.sh && curl https://rclone.org/install.sh | bash

# Install Nixpacks and tsx.
# Binaries are pre-downloaded to .docker-tools/ to avoid GitHub CDN timeouts
# inside Docker BuildKit. Regenerate with:
#   curl -L -o .docker-tools/nixpacks.tar.gz https://github.com/railwayapp/nixpacks/releases/download/v1.41.0/nixpacks-v1.41.0-x86_64-unknown-linux-musl.tar.gz
#   tar -xzf .docker-tools/nixpacks.tar.gz -C .docker-tools/
ARG NIXPACKS_VERSION=1.41.0
COPY .docker-tools/nixpacks /usr/local/bin/nixpacks
RUN chmod +x /usr/local/bin/nixpacks && pnpm install -g tsx

# Install Railpack.
# Regenerate with:
#   curl -L -o .docker-tools/railpack.tar.gz https://github.com/railwayapp/railpack/releases/download/v0.15.4/railpack-v0.15.4-x86_64-unknown-linux-musl.tar.gz
#   tar -xzf .docker-tools/railpack.tar.gz -C .docker-tools/
ARG RAILPACK_VERSION=0.15.4
COPY .docker-tools/railpack /usr/local/bin/railpack
RUN chmod +x /usr/local/bin/railpack

# Install buildpacks
COPY --from=buildpacksio/pack:0.39.1 /usr/local/bin/pack /usr/local/bin/pack

# Copy only the necessary files (after tool installs so a code-only change
# doesn't bust the expensive tool-installation cache layers above)
COPY --from=build /prod/dokploy/.next ./.next
COPY --from=build /prod/dokploy/dist ./dist
COPY --from=build /prod/dokploy/next.config.mjs ./next.config.mjs
COPY --from=build /prod/dokploy/public ./public
COPY --from=build /prod/dokploy/package.json ./package.json
COPY --from=build /prod/dokploy/drizzle ./drizzle
COPY .env.production ./.env
COPY --from=build /prod/dokploy/components.json ./components.json
COPY --from=build /prod/dokploy/node_modules ./node_modules

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD curl -fs http://localhost:3000/api/trpc/settings.health || exit 1

  CMD ["sh", "-c", "pnpm run wait-for-postgres && exec pnpm start"]
