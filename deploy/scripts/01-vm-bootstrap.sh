#!/usr/bin/env bash
# One-time VM setup: system packages, the service user, and the two
# systemd units (installed + enabled, but not started yet — that happens
# once their .env files exist and 02/03 have each built and started their
# app for the first time). Safe to re-run; every step checks before it acts.
#
# Prerequisite: you've already `git clone`d this repo onto the VM — this
# script lives inside that checkout, so it can't be what clones it.
#
# Usage: sudo ./01-vm-bootstrap.sh
# Assumes Ubuntu/Debian (apt).

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
require_root
load_env

log "installing system packages"
apt-get update -y
apt-get install -y curl git nginx certbot python3-certbot-nginx gettext-base

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/^v//;s/\..*//')" -lt 20 ]; then
  log "installing Node 20.x"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

if ! command -v pnpm >/dev/null 2>&1; then
  log "enabling pnpm via corepack"
  corepack enable
  corepack prepare pnpm@latest --activate
fi

NODE_BIN="$(command -v node)"
PNPM_BIN="$(command -v pnpm)"
log "node: $NODE_BIN ($(node -v)), pnpm: $PNPM_BIN ($(pnpm -v))"

if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  log "creating service user $SERVICE_USER"
  useradd --system --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

log "handing the checkout to $SERVICE_USER"
chown -R "$SERVICE_USER:$SERVICE_USER" "$REPO_ROOT"

log "installing systemd units"
export REPO_ROOT SERVICE_USER NODE_BIN PNPM_BIN
render_template "$DEPLOY_DIR/systemd/uttarakhand-bot.service.template" \
  /etc/systemd/system/uttarakhand-bot.service \
  REPO_ROOT SERVICE_USER NODE_BIN PNPM_BIN
render_template "$DEPLOY_DIR/systemd/uttarakhand-admin.service.template" \
  /etc/systemd/system/uttarakhand-admin.service \
  REPO_ROOT SERVICE_USER NODE_BIN PNPM_BIN

systemctl daemon-reload
systemctl enable uttarakhand-bot uttarakhand-admin

log "bootstrap done."
log "Next: create apps/bot/.env and apps/admin/.env.local (see their .env.example files),"
log "then run 02-deploy-bot.sh and 03-deploy-admin.sh."
