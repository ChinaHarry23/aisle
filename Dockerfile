# On-site image for the Week 13 demonstration.
# Build it on the demo machine from this source tree. Do not swap in a
# prebuilt image from another computer.
#
# The container is the whole demo: Next.js production server, SQLite on
# /app/data, the Australian advertising-law texts, and ffmpeg for story ads.
# Campaign agents run inside the Next.js process. The optional workflow and
# media workers are not started; leave AISLE_WORKFLOW_URL unset.
#
# Node 22.18+ is required for node:sqlite with no experimental flag.

ARG NODE_VERSION=22-bookworm-slim

FROM node:${NODE_VERSION} AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./

RUN --mount=type=cache,target=/root/.npm \
  npm ci --no-audit --no-fund

FROM node:${NODE_VERSION} AS builder

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build \
  && test -s .next/standalone/server.js \
  && test -d node_modules/sharp \
  && test -d node_modules/@img

FROM node:${NODE_VERSION} AS runner

WORKDIR /app

# ffmpeg/ffprobe edit the 30-second story ads. gosu drops root after the
# entrypoint fixes the data-volume owner. This layer does not depend on the
# app source, so a code change does not reinstall the packages.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg gosu \
  && rm -rf /var/lib/apt/lists/* \
  && command -v ffmpeg >/dev/null \
  && command -v ffprobe >/dev/null \
  && command -v gosu >/dev/null

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV AISLE_DB=sqlite
ENV AISLE_DB_FILE=/app/data/aisle.db
ENV AISLE_MEDIA_DIR=/app/data/generated-media
ENV AISLE_HOSTED=0
ENV AISLE_SEED_PASSWORD=aisle-demo-2026

RUN mkdir -p /app/data/generated-media \
  && chown -R node:node /app/data

COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
# Read at runtime from process.cwd()/services/knowledge/law. Standalone
# tracing does not follow that dynamic path, so copy the corpus explicitly.
COPY --from=builder --chown=node:node /app/services/knowledge ./services/knowledge
# sharp's Linux binary is not always traced into the standalone node_modules.
COPY --from=builder --chown=node:node /app/node_modules/sharp ./node_modules/sharp
COPY --from=builder --chown=node:node /app/node_modules/@img ./node_modules/@img
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod 755 /usr/local/bin/docker-entrypoint.sh \
  && node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 18)) { console.error("Need Node 22.18 or newer, got " + process.versions.node); process.exit(1); } require("node:sqlite");'

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=25s --retries=8 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
