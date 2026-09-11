# Multi-stage build. Debian base, NOT Alpine: better-sqlite3 ships glibc
# prebuilds, and musl would force a native compile (SPEC §10.4).
#
# Pin the distro, not just the Node major — `node:22-slim` alone can move to a
# newer Debian release and change what the apt-get below can install. Node 20
# reached end-of-life in April 2026; this image and the dev container are on
# the same major deliberately, so the types describe the machine that runs it.
FROM node:22-bookworm-slim AS build

WORKDIR /app

# Build tools, in case a prebuilt better-sqlite3 binary isn't available for
# this platform and npm has to compile it from source.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && apt-get clean \
  && find /var/lib/apt/lists -mindepth 1 -delete

COPY package.json package-lock.json ./
# The repo's .npmrc sets ignore-scripts, which would skip better-sqlite3's
# install step; allow it here so the native addon is actually built.
RUN npm ci --ignore-scripts=false

COPY tsconfig.base.json ./
COPY server ./server
COPY web ./web
COPY scripts ./scripts

# This stage has no .git, so the footer's version stamp has to be passed in.
# Without these it falls back to the package.json version and "unknown".
#   docker build --build-arg BUILD_TAG="$(git describe --tags --abbrev=0)" \
#                --build-arg BUILD_COMMIT="$(git rev-parse --short HEAD)" .
#
# Railway hands every service variable to the build as a build arg, but only
# for names declared with ARG here — so declare its own commit variable and
# let it be the default. An explicit BUILD_COMMIT still wins. The tag has no
# platform equivalent; the package.json version stands in for it.
ARG RAILWAY_GIT_COMMIT_SHA
ARG BUILD_TAG
ARG BUILD_COMMIT=${RAILWAY_GIT_COMMIT_SHA}
ENV BUILD_TAG=$BUILD_TAG
ENV BUILD_COMMIT=$BUILD_COMMIT

# Into the build log, so a footer reading "unknown" can be traced to the arg
# that never arrived rather than guessed at from the outside.
RUN echo "build stamp: tag=${BUILD_TAG:-<unset>} commit=${BUILD_COMMIT:-<unset>}"

RUN npm run build

# Drop dev dependencies from the tree we copy into the runtime image.
RUN npm prune --omit=dev --ignore-scripts=false


FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV DATABASE_PATH=/data/app.db
ENV PORT=3000
ENV SERVE_STATIC=1

WORKDIR /app

# Runtime needs no compiler; the addon is already built.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/migrations ./server/migrations
COPY --from=build /app/web/dist ./web/dist

# The DB lives on a volume mounted at /data so it survives image rebuilds —
# declared by the caller (compose's `./data:/data`, or a Railway volume), not by
# a Dockerfile VOLUME. Railway rejects that instruction outright, and it earns
# nothing here: with a bind mount it is a no-op, and without one it quietly
# conjures an anonymous volume that hides the fact you forgot to mount anything.
RUN mkdir -p /data && chown -R node:node /data /app

# gosu drops privileges without the signal-forwarding and TTY problems `su`
# brings; the app must stay PID 1 for its graceful shutdown to see SIGTERM.
RUN apt-get update \
  && apt-get install -y --no-install-recommends gosu \
  && apt-get clean \
  && find /var/lib/apt/lists -mindepth 1 -delete

COPY deploy/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Deliberately NOT `USER node`. The mounted volume arrives owned by root, and a
# container that has already dropped privileges cannot chown it — which is the
# SQLITE_CANTOPEN crash. The entrypoint starts as root, fixes the volume, and
# then execs the app as `node`, so the app itself never runs privileged.
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/events').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "server/dist/index.js"]
