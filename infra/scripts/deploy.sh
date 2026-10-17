#!/usr/bin/env bash
# @file  infra/scripts/deploy.sh
# @area  Ops
# @what  Deploy a version: check out its git tag → pull (or build) images → migrations → start → readiness check through Caddy → automatic rollback on failure.
#
# Usage (as the deploy user, in /srv/pnl-lens):   infra/scripts/deploy.sh <version>      e.g. v1.0.0
#   The git tag <version> is checked out first, so compose file, Caddyfile and scripts match the images.
#   With IMAGE_REGISTRY in .env (e.g. ghcr.io/<owner>/pnl-lens) the images <registry>/<svc>:<version> are pulled
#   (.github/workflows/deploy.yml builds them on a v* tag). Without it the images are built here (local VM test).
#   Migrations must stay backward compatible (add, don't drop): a rollback restarts the previous code on the newer schema.
# shellcheck source=infra/scripts/lib.sh
. "$(dirname "$0")/lib.sh"

start() {
  local v="$1"
  git fetch --quiet --tags origin 2>/dev/null || true
  git -c advice.detachedHead=false checkout --quiet "$v"
  export IMAGE_TAG="$v"
  if [ -n "${IMAGE_REGISTRY:-}" ]; then
    dc pull --quiet --ignore-buildable 2>/dev/null || dc pull --quiet
    dc up -d --remove-orphans --wait --wait-timeout 300
  else
    dc up -d --build --remove-orphans --wait --wait-timeout 900
  fi
  # Caddy keeps running across deploys: load this version's Caddyfile (graceful; an invalid file fails the deploy)
  dc exec -T caddy caddy reload --config /etc/caddy/Caddyfile.prod --adapter caddyfile
}

check() {
  for _ in $(seq 1 24); do ready && return 0; sleep 5; done
  return 1
}

main() {
  local version="${1:?usage: deploy.sh <version>}" previous
  load_env
  : "${DOMAIN:?DOMAIN missing in .env}"
  mkdir -p .deploy
  previous="$(cat .deploy/current 2>/dev/null || true)"
  log "deploy_start" "\"version\":\"$version\",\"previous\":\"$previous\""
  if start "$version" && check; then
    if [ -n "$previous" ] && [ "$previous" != "$version" ]; then echo "$previous" > .deploy/previous; fi
    echo "$version" > .deploy/current
    docker image prune -f >/dev/null 2>&1 || true
    log "deploy_ok" "\"version\":\"$version\""
    return 0
  fi
  log "deploy_failed" "\"version\":\"$version\""
  dc ps || true
  dc logs --tail=50 api worker web caddy 2>&1 | tail -100 || true
  if [ -n "$previous" ] && [ "$previous" != "$version" ]; then
    log "rollback_start" "\"to\":\"$previous\""
    if start "$previous" && check; then log "rollback_ok" "\"to\":\"$previous\""; else log "rollback_failed" "\"to\":\"$previous\""; fi
  fi
  return 1
}

# Everything runs inside main(): bash has read the whole function before `git checkout` replaces this file.
main "$@"; exit $?
