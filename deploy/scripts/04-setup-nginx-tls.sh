#!/usr/bin/env bash
# Reverse proxy + TLS for the single shared domain (bot at /, admin at
# /admin). Run this AFTER 02/03 have each deployed successfully at least
# once (nginx needs something real behind it). DNS for DOMAIN must already
# point at this VM's public IP before you run this — Let's Encrypt's
# HTTP-01 challenge needs that to already resolve, it does not wait or
# retry over hours.
#
# Safe to re-run: it just re-renders the nginx config and asks certbot to
# renew/reuse the certificate, both idempotent.
#
# Usage: sudo ./04-setup-nginx-tls.sh

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
require_root
load_env

log "rendering nginx server block"
export DOMAIN BOT_PORT ADMIN_PORT
render_template "$DEPLOY_DIR/nginx/app.conf.template" \
  /etc/nginx/sites-available/uttarakhand.conf \
  DOMAIN BOT_PORT ADMIN_PORT

ln -sf /etc/nginx/sites-available/uttarakhand.conf /etc/nginx/sites-enabled/uttarakhand.conf

log "checking nginx config"
nginx -t

log "reloading nginx (HTTP only for now, so certbot's challenge has something to answer it)"
systemctl reload nginx

log "requesting/renewing certificate via Let's Encrypt"
certbot --nginx \
  -d "$DOMAIN" \
  --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect

log "done. Verify with:"
log "  curl -I https://$DOMAIN/"
log "  curl -I https://$DOMAIN/admin/login"
log "Certbot installs its own renewal timer (systemctl list-timers | grep certbot) — nothing more to do for renewals."
