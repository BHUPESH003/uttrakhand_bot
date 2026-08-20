#!/usr/bin/env bash
# Shared helpers sourced by every script in this directory. Never run this
# file directly — `source` it, as the other scripts do.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_root() {
  [ "$(id -u)" -eq 0 ] || die "run this as root: sudo $0"
}

# Loads deploy/.env.deploy and exports every variable in it — envsubst
# (used by render_template) reads from the process environment, not from a
# file directly. Fails loudly, listing exactly what's missing, rather than
# limping along with an unset domain or port.
load_env() {
  local env_file="$DEPLOY_DIR/.env.deploy"
  [ -f "$env_file" ] || die "$env_file not found — copy .env.deploy.example there and fill it in first"

  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a

  local required=(BOT_DOMAIN ADMIN_DOMAIN BOT_PORT ADMIN_PORT CERTBOT_EMAIL SERVICE_USER GIT_BRANCH)
  local missing=()
  for var in "${required[@]}"; do
    [ -n "${!var:-}" ] || missing+=("$var")
  done
  [ ${#missing[@]} -eq 0 ] || die "missing required vars in $env_file: ${missing[*]}"
}

# Fetches and hard-resets the checkout to origin/$GIT_BRANCH. A plain `git
# pull` would leave stray local changes in place; this VM's copy is a
# deploy target, so a clean reset is the right default every time.
git_sync() {
  log "syncing $REPO_ROOT to origin/$GIT_BRANCH"
  git -C "$REPO_ROOT" fetch origin "$GIT_BRANCH"
  git -C "$REPO_ROOT" reset --hard "origin/$GIT_BRANCH"
}

# Renders a template with envsubst, restricted to the given variable names.
# Bare envsubst would also expand any other "$word"-looking text already
# in the template — nginx's $host/$remote_addr/$scheme in particular must
# NOT be touched, which is why this always takes an explicit whitelist
# instead of substituting everything in the environment.
render_template() {
  local template="$1" output="$2"; shift 2
  local varlist=""
  for v in "$@"; do varlist="$varlist\$$v"; done
  envsubst "$varlist" < "$template" > "$output"
}

require_env_file() {
  local path="$1"
  [ -f "$path" ] || die "$path is missing — copy its .example and fill in real values before deploying"
}
