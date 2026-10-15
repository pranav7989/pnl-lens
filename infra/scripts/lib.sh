#!/usr/bin/env bash
# @file  infra/scripts/lib.sh
# @area  Ops
# @what  Shared helpers for the server scripts: repo root, safe .env loading (no shell evaluation), compose wrapper, JSON log lines.
# shellcheck disable=SC2034
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
COMPOSE_FILE="${COMPOSE_FILE:-infra/compose.prod.yml}"
PROJECT="${COMPOSE_PROJECT_NAME:-pnl-lens}"            # another name only for rehearsals next to a dev stack
INTERNAL_NET="${PROJECT}_internal"
# The deployed version (deploy.sh records it), so backup/restore/healthcheck address the running images.
IMAGE_TAG="${IMAGE_TAG:-$(cat .deploy/current 2>/dev/null || echo local)}"
export IMAGE_TAG
RESTIC_IMAGE=restic/restic:0.19.1
AWS_IMAGE=amazon/aws-cli:2.37.3

log() { printf '{"time":"%s","script":"%s","event":"%s"%s}\n' "$(date -u +%FT%TZ)" "$(basename "$0")" "$1" "${2:+,$2}"; }
die() { log "error" "\"message\":\"$1\""; exit 1; }

# .env values may contain spaces or < > (e.g. MAIL_FROM), so they are read literally instead of sourced.
load_env() {
  [ -f .env ] || die ".env not found in $ROOT (create it from .env.example; secrets: node infra/scripts/gen-env.mjs)"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    key="${line%%=*}"; val="${line#*=}"
    [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    export "$key=$val"
  done < .env
}

dc() { docker compose -p "$PROJECT" --env-file .env -f "$COMPOSE_FILE" "$@"; }

# Readiness through Caddy, exactly as visitors reach it (self-signed allowed for the VM test).
ready() {
  curl -fsk --max-time 5 --resolve "${DOMAIN}:443:127.0.0.1" "https://${DOMAIN}/api/v1/ready" >/dev/null
}
