#!/usr/bin/env bash
# Rebuilds and restarts the bot. Safe to run any time there's a new commit
# on $GIT_BRANCH — syncs the checkout, builds only what the bot needs
# (types, db, bot), applies any pending migrations, restarts the service,
# then checks it's actually answering before declaring success.
#
# Usage: sudo ./02-deploy-bot.sh

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
require_root
load_env
require_env_file "$REPO_ROOT/apps/bot/.env"

git_sync

log "installing dependencies"
cd "$REPO_ROOT"
pnpm install --frozen-lockfile

log "building types -> db -> bot"
pnpm --filter types build
pnpm --filter db build
pnpm --filter bot build

log "applying pending migrations"
pnpm --filter db migrate:deploy

log "restoring file ownership to $SERVICE_USER"
chown -R "$SERVICE_USER:$SERVICE_USER" "$REPO_ROOT"

log "restarting uttarakhand-bot"
systemctl restart uttarakhand-bot

log "waiting for it to answer on :$BOT_PORT"
for _ in $(seq 1 15); do
  if curl -sf "http://127.0.0.1:$BOT_PORT/" | grep -q '"status":"ok"'; then
    log "bot is up"
    exit 0
  fi
  sleep 1
done
die "bot did not come up on :$BOT_PORT — check: journalctl -u uttarakhand-bot -n 50"
