#!/bin/sh
# Zip this source tree for the Canvas submission. The zip excludes installed
# dependencies, build output, local databases and secrets. Run it on the
# machine that has the project, before upload. The demo machine builds from
# the unzipped result. See SETUP.md.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
out=${1:-"$root/../aisle-canvas-submission.zip"}
out_dir=$(CDPATH= cd -- "$(dirname "$out")" && pwd)
out="$out_dir/$(basename "$out")"

case "$out" in
  "$root"|"$root"/*)
    echo "Refusing to write the zip inside the project. Pass a path outside it, or use the default (the parent folder)." >&2
    exit 1
    ;;
esac

if ! command -v rsync >/dev/null 2>&1 || ! command -v zip >/dev/null 2>&1; then
  echo "This script needs rsync and zip, which macOS includes." >&2
  exit 1
fi

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

rsync -a \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude '.next/' \
  --exclude 'out/' \
  --exclude 'data/' \
  --exclude 'coverage/' \
  --exclude '.vercel/' \
  --exclude '.cursor/' \
  --exclude 'codex/' \
  --exclude '.langgraph_api/' \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude '.env.development.local' \
  --exclude '.env.production.local' \
  --exclude '.DS_Store' \
  --exclude '*.db' \
  --exclude '*.db-journal' \
  --exclude '*.db-wal' \
  --exclude '*.db-shm' \
  --exclude '*.mp4' \
  --exclude '*.mov' \
  --exclude '*.log' \
  --exclude '*.zip' \
  --exclude '*.tsbuildinfo' \
  "$root/" "$stage/aisle/"

for required in \
  SETUP.md \
  Dockerfile \
  docker-compose.yml \
  docker-entrypoint.sh \
  package.json \
  package-lock.json \
  .env.example \
  scripts/onsite-up.sh \
  scripts/onsite-node.sh \
  services/knowledge/law/AU/text/competition-and-consumer-act-2010-volume-4.txt
do
  if [ ! -f "$stage/aisle/$required" ]; then
    echo "The zip would be missing ${required}. Do not upload it." >&2
    exit 1
  fi
done

if find "$stage/aisle" \( -name node_modules -o -name .next -o -name .env.local -o -name '*.db' \) -print | grep -q .; then
  echo "The staging copy still contains dependencies, build output, a secret file, or a database. Do not upload it." >&2
  find "$stage/aisle" \( -name node_modules -o -name .next -o -name .env.local -o -name '*.db' \) -print >&2
  exit 1
fi

rm -f "$out"
(cd "$stage" && zip -r -q -y "$out" aisle)
echo "Wrote ${out}"
du -sh "$out"
echo "Upload this zip to Canvas. On the demo VM, unzip it and follow SETUP.md."
