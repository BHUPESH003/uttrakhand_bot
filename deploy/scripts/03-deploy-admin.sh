#!/usr/bin/env bash
# Rebuilds and restarts the admin dashboard. Mirrors 02-deploy-bot.sh —
# see that script's comments for the general shape. Also runs
# migrate:deploy (harmless if 02 already applied everything — Prisma skips
# migrations that are already applied) so this doesn't silently depend on
# deploy order.
#
# Usage: sudo ./03-deploy-admin.sh

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
require_root
load_env
require_env_file "$REPO_ROOT/apps/admin/.env.local"

git_sync

log "installing dependencies"
cd "$REPO_ROOT"
pnpm install --frozen-lockfile

log "building types -> theme -> db -> admin"
pnpm --filter types build
pnpm --filter theme build
pnpm --filter db build
pnpm --filter admin build

log "applying pending migrations"
pnpm --filter db migrate:deploy

log "restoring file ownership to $SERVICE_USER"
chown -R "$SERVICE_USER:$SERVICE_USER" "$REPO_ROOT"

log "restarting uttarakhand-admin"
systemctl restart uttarakhand-admin

log "waiting for it to answer on :$ADMIN_PORT"
for _ in $(seq 1 15); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$ADMIN_PORT/admin/login/")"
  if [ "$code" = "200" ]; then
    log "admin is up"
    exit 0
  fi
  sleep 1
done
die "admin did not come up on :$ADMIN_PORT — check: journalctl -u uttarakhand-admin -n 50"
