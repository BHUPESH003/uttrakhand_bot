#!/usr/bin/env bash
# Deploys apps/web to Vercel. Run this from YOUR OWN machine, not the VM —
# Vercel builds and hosts it, this script just triggers that and pushes
# env vars first.
#
# First run: `vercel link` below is interactive (asks which Vercel scope/
# project, and — important for this monorepo — confirms the current
# directory, apps/web, as this project's root). That's expected, it only
# happens once per machine.
#
# Env vars are read from apps/web/.env.production.local (gitignored — copy
# apps/web/.env.example there and fill in real values) rather than typed
# into the Vercel dashboard, so they're versioned locally and reviewable
# in a diff before every push.
#
# Usage: ./05-deploy-web-vercel.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(cd "$SCRIPT_DIR/../../apps/web" && pwd)"
ENV_FILE="$WEB_DIR/.env.production.local"

command -v vercel >/dev/null 2>&1 || {
  echo "ERROR: Vercel CLI not found — install it with: npm i -g vercel" >&2
  exit 1
}
[ -f "$ENV_FILE" ] || {
  echo "ERROR: $ENV_FILE not found — copy apps/web/.env.example there and fill in real values" >&2
  exit 1
}

cd "$WEB_DIR"

if [ ! -f .vercel/project.json ]; then
  echo "Linking $WEB_DIR to a Vercel project (one-time, interactive)..."
  vercel link
fi

echo "Pushing env vars from $ENV_FILE to Vercel (production)..."
while IFS='=' read -r key value; do
  [ -z "$key" ] && continue
  case "$key" in \#*) continue ;; esac
  # Strip optional surrounding quotes some .env styles use.
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  # Replace, not append: remove any existing value for this key first so
  # re-running this script updates it instead of erroring on a duplicate.
  vercel env rm "$key" production --yes >/dev/null 2>&1 || true
  printf '%s' "$value" | vercel env add "$key" production
done < "$ENV_FILE"

echo "Deploying to production..."
vercel --prod

# Note: if `vercel env rm/add` errors on your installed CLI version, the
# exact flag names have moved before — check `vercel env --help` and adjust.
