#!/bin/sh
# Starts the on-site demo. Root only fixes /app/data ownership, then the
# server runs as the unprivileged node user.
set -eu

if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data/generated-media
  chown -R node:node /app/data
  exec gosu node /usr/local/bin/docker-entrypoint.sh "$@"
fi

# Docker sets HOSTNAME to the container id. The standalone server binds to
# that name unless this is forced, and the published port then refuses connections.
export HOSTNAME=0.0.0.0
export PORT="${PORT:-3000}"
export AISLE_DB="${AISLE_DB:-sqlite}"
export AISLE_DB_FILE="${AISLE_DB_FILE:-/app/data/aisle.db}"
export AISLE_MEDIA_DIR="${AISLE_MEDIA_DIR:-/app/data/generated-media}"
export AISLE_HOSTED="${AISLE_HOSTED:-0}"
export AISLE_SEED_PASSWORD="${AISLE_SEED_PASSWORD:-aisle-demo-2026}"

if [ -z "${AUTH_SECRET:-}" ]; then
  # Published classroom secret. SETUP.md tells the demo agent this value.
  # It is not a production secret. Do not put this container on the internet.
  export AUTH_SECRET="aisle-onsite-demo-auth-secret-2026"
  echo "AUTH_SECRET was empty. Using the on-site demo secret from SETUP.md."
fi

if [ ! -w /app/data ]; then
  echo "/app/data is not writable by uid $(id -u). The SQLite database and generated media live there." >&2
  exit 1
fi

law_dir=/app/services/knowledge/law/AU/text
for law_file in \
  competition-and-consumer-act-2010-volume-4.txt \
  accc-advertising-and-selling-guide-july-2021.txt \
  accc-making-environmental-claims-december-2023.txt \
  country-of-origin-food-labelling-information-standard-2016.txt \
  copyright-act-1968-compilation-65.txt \
  spam-act-2003-compilation-10.txt \
  aana-code-of-ethics-2021.txt
do
  if [ ! -s "$law_dir/$law_file" ]; then
    echo "Missing advertising-law text: $law_dir/$law_file" >&2
    echo "The image was built without services/knowledge. Rebuild from the project root: docker compose up --build -d" >&2
    exit 1
  fi
done

node -e 'const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(":memory:"); db.exec("select 1 as ok"); require("sharp");'
node -e 'const { execFileSync } = require("node:child_process"); execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); execFileSync("ffprobe", ["-version"], { stdio: "ignore" });'

echo ""
echo "Aisle on-site demo"
echo "  Container port: ${PORT}"
echo "  Health:         http://127.0.0.1:${PORT}/api/health"
echo "  Sign in:        alex@aisle.website"
echo "  Password:       aisle-demo-2026"
echo "  Database:       ${AISLE_DB_FILE}"
echo "  No API key is required. Agents fall back to the built-in rules."
echo ""

exec "$@"
