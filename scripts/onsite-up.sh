#!/bin/sh
# Build and start the on-site demo from this source tree. See SETUP.md.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"

if [ ! -f package.json ] || [ ! -f Dockerfile ] || [ ! -f docker-compose.yml ] || [ ! -f SETUP.md ]; then
  echo "Run this from the unzipped Aisle project. package.json, Dockerfile, docker-compose.yml and SETUP.md must be in the same folder." >&2
  exit 1
fi

case "$root" in
  /Volumes/*|/media/*|*/Shared\ Folders/*|*/Parallels\ Shared\ Folders/*)
    echo "This folder is on a shared drive. Copy the unzipped project onto the VM's own disk (for example ~/aisle) and run the script from there. Docker builds from a Parallels shared folder are slow and often fail." >&2
    exit 1
    ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Install Docker Desktop, or use Path B in SETUP.md: sh scripts/onsite-node.sh" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but the engine is not running. Open Docker Desktop, wait until it is ready, then run this script again." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is missing. Update Docker Desktop, then run this script again. The command is 'docker compose', not 'docker-compose'." >&2
  exit 1
fi

port="${AISLE_PORT:-3000}"
export AISLE_PORT="$port"

if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
  published=$(docker compose port aisle 3000 2>/dev/null || true)
  case "$published" in
    *:"$port")
      echo "Port ${port} is already published by this Aisle container. Rebuilding it."
      ;;
    *)
      echo "Port ${port} is already in use by another process. Stop it, or choose another host port:" >&2
      echo "  AISLE_PORT=3001 sh scripts/onsite-up.sh" >&2
      echo "Then open http://localhost:3001" >&2
      exit 1
      ;;
  esac
fi

echo "Building Aisle from ${root}"
echo "The first build downloads Node and npm packages. On a Parallels VM this often takes 8–20 minutes."
docker compose up --build -d

echo "Waiting for http://127.0.0.1:${port}/api/health"
health_file=$(mktemp)
trap 'rm -f "$health_file"' EXIT

i=0
while [ "$i" -lt 90 ]; do
  if curl -fsS "http://127.0.0.1:${port}/api/health" >"$health_file" 2>/dev/null; then
    if grep -q '"ok":true' "$health_file" || grep -q '"ok": true' "$health_file"; then
      echo ""
      echo "Healthy. Response:"
      cat "$health_file"
      echo ""
      echo ""
      echo "Open http://localhost:${port} in a browser on this VM."
      echo "Sign in: alex@aisle.website"
      echo "Password: aisle-demo-2026"
      echo "Other desks use the same password: sam@, jordan@, riley@, casey@ aisle.website"
      exit 0
    fi
  fi
  i=$((i + 1))
  sleep 2
done

echo "The server did not become healthy. Last health body:" >&2
cat "$health_file" >&2 || true
echo "" >&2
echo "Recent container logs:" >&2
docker compose logs --tail=120 aisle >&2 || true
exit 1
