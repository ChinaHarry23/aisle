#!/bin/sh
# Native fallback when Docker cannot run inside the Parallels macOS VM.
# See SETUP.md Path B. This process stays in the foreground.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"

if [ ! -f package.json ] || [ ! -f package-lock.json ]; then
  echo "Run this from the unzipped Aisle project." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm are not on PATH. Install Node.js 22.18 or newer from https://nodejs.org/ (the macOS installer), then open a new terminal and run this script again." >&2
  exit 1
fi

node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 18)) { console.error("Need Node.js 22.18 or newer. This machine has " + process.versions.node + ". Install a current Node 22 or Node 24 LTS from https://nodejs.org/ and open a new terminal."); process.exit(1); } require("node:sqlite"); console.log("Node " + process.versions.node + " has node:sqlite.");'

port="${AISLE_PORT:-3000}"
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port ${port} is already in use. Stop the other process, or run: AISLE_PORT=3001 sh scripts/onsite-node.sh" >&2
  exit 1
fi

echo "Installing locked dependencies with npm ci. This needs a network and often takes a few minutes."
npm ci --no-audit --no-fund

if [ ! -f .env.local ]; then
  cat > .env.local <<'EOF'
# Created by scripts/onsite-node.sh for the on-site demo. Do not commit this file.
AUTH_SECRET=aisle-onsite-demo-auth-secret-2026
AISLE_SEED_PASSWORD=aisle-demo-2026
AISLE_HOSTED=0
AISLE_DB=sqlite
EOF
  echo "Wrote .env.local with the demo AUTH_SECRET. This file is gitignored."
elif ! grep -q '^AUTH_SECRET=.' .env.local; then
  printf '\nAUTH_SECRET=aisle-onsite-demo-auth-secret-2026\n' >> .env.local
  echo "Appended AUTH_SECRET to the existing .env.local."
fi

# Shell values win over .env.local. Keep this demo on the local SQLite file
# even if the terminal inherited a hosted DATABASE_URL.
export AUTH_SECRET="${AUTH_SECRET:-aisle-onsite-demo-auth-secret-2026}"
export AISLE_SEED_PASSWORD="${AISLE_SEED_PASSWORD:-aisle-demo-2026}"
export AISLE_HOSTED=0
export AISLE_DB=sqlite
unset DATABASE_URL POSTGRES_URL POSTGRES_PRISMA_URL AISLE_DATABASE_URL NEON_DATABASE_URL STORAGE_URL || true

echo "Building the production server from this source."
NEXT_TELEMETRY_DISABLED=1 npm run build

echo ""
echo "Starting Aisle. Leave this terminal open."
echo "Open http://localhost:${port} in a browser on this VM."
echo "Sign in: alex@aisle.website"
echo "Password: aisle-demo-2026"
echo "Stop the server with Ctrl-C."
echo ""
exec npm run start -- --hostname 0.0.0.0 --port "$port"
