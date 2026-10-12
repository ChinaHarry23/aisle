#!/bin/sh
set -eu

if [ -z "${AUTH_SECRET:-}" ]; then
  echo "AUTH_SECRET is required. Pass -e AUTH_SECRET=... or put it in .env.local." >&2
  exit 1
fi

# Docker sets HOSTNAME to the container id. The standalone server binds to that
# name unless this is forced, and the published port then refuses connections.
export HOSTNAME=0.0.0.0
export PORT="${PORT:-3000}"

mkdir -p /app/data /app/data/generated-media
if [ ! -w /app/data ]; then
  echo "/app/data is not writable by uid $(id -u). The SQLite database and generated media live there." >&2
  exit 1
fi

exec "$@"
