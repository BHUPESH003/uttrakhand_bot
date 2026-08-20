#!/usr/bin/env bash
# Reverse proxy + TLS for both domains. Run this AFTER 02/03 have each
# deployed successfully at least once (nginx needs something real behind
# it). DNS for both BOT_DOMAIN and ADMIN_DOMAIN must already point at this
# VM's public IP before you run this — Let's Encrypt's HTTP-01 challenge
# needs that to already resolve, it does not wait or retry over hours.
#
# Safe to re-run: it just re-renders the nginx config and asks certbot to
# renew/reuse the certificate, both idempotent.
#
# Usage: sudo ./04-setup-nginx-tls.sh

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
require_root
load_env

log "rendering nginx server blocks"
export BOT_DOMAIN ADMIN_DOMAIN BOT_PORT ADMIN_PORT
render_template "$DEPLOY_DIR/nginx/bot.conf.template" \
  /etc/nginx/sites-available/uttarakhand-bot.conf \
  BOT_DOMAIN BOT_PORT
render_template "$DEPLOY_DIR/nginx/admin.conf.template" \
  /etc/nginx/sites-available/uttarakhand-admin.conf \
  ADMIN_DOMAIN ADMIN_PORT

ln -sf /etc/nginx/sites-available/uttarakhand-bot.conf /etc/nginx/sites-enabled/uttarakhand-bot.conf
ln -sf /etc/nginx/sites-available/uttarakhand-admin.conf /etc/nginx/sites-enabled/uttarakhand-admin.conf

log "checking nginx config"
nginx -t

log "reloading nginx (HTTP only for now, so certbot's challenge has something to answer it)"
systemctl reload nginx

log "requesting/renewing certificates via Let's Encrypt"
certbot --nginx \
  -d "$BOT_DOMAIN" -d "$ADMIN_DOMAIN" \
  --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect

log "done. Verify with:"
log "  curl -I https://$BOT_DOMAIN/"
log "  curl -I https://$ADMIN_DOMAIN/login"
log "Certbot installs its own renewal timer (systemctl list-timers | grep certbot) — nothing more to do for renewals."
