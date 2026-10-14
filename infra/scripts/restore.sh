#!/usr/bin/env bash
# @file  infra/scripts/restore.sh
# @area  Ops
# @what  Restore from a restic snapshot: database + statement objects, then migrations and a readiness check. Stops the app while it runs.
#
# Usage:  infra/scripts/restore.sh [snapshot-id|latest]
# The .env must hold the same FILE_KEK_* keys as when the backup was made (statements are encrypted with them),
# and the same S3/Garage keys or new ones (storage-init recreates buckets and keys). Queued jobs in Redis are not
# restored: uploads that were still being analysed must be uploaded again.
# shellcheck source=infra/scripts/lib.sh
. "$(dirname "$0")/lib.sh"
SNAP="${1:-latest}"
load_env
: "${RESTIC_REPOSITORY:?}"; : "${RESTIC_PASSWORD:?}"; : "${DOMAIN:?}"
WORK="$ROOT/.restore/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT
# a local repository is mounted read-write: restic writes a lock file even to restore
mount=(); case "$RESTIC_REPOSITORY" in /*) mount=(-v "$RESTIC_REPOSITORY:$RESTIC_REPOSITORY") ;; esac

log "restore_start" "\"snapshot\":\"$SNAP\""
docker run --rm -v "$WORK:/restore" ${mount[@]+"${mount[@]}"} -e RESTIC_REPOSITORY -e RESTIC_PASSWORD -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
  "$RESTIC_IMAGE" restore "$SNAP" --tag pnl-lens --target /restore --quiet
[ -s "$WORK/backup/db.dump" ] || die "snapshot has no db.dump"

dc stop caddy web api worker >/dev/null 2>&1 || true
dc up -d --wait postgres redis garage
dc run --rm --no-deps migrate >/dev/null      # every role and object first (grants in the dump refer to the roles); --clean then replaces the objects
docker cp "$WORK/backup/db.dump" "$(dc ps -q postgres)":/tmp/db.dump
PGPASSWORD="$POSTGRES_PASSWORD" dc exec -T -e PGPASSWORD postgres pg_restore -h 127.0.0.1 -U "${POSTGRES_USER:-lens_admin}" -d lens --clean --if-exists --no-owner --exit-on-error /tmp/db.dump
dc exec -T postgres rm -f /tmp/db.dump
dc run --rm --no-deps storage-init >/dev/null
AWS_ACCESS_KEY_ID="$S3_WORKER_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$S3_WORKER_SECRET_ACCESS_KEY" \
  docker run --rm --network "$INTERNAL_NET" -v "$WORK/backup/statements:/in:ro" \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION=garage -e AWS_EC2_METADATA_DISABLED=true \
  "$AWS_IMAGE" --endpoint-url http://garage:3900 s3 sync /in s3://statements --only-show-errors
dc up -d --wait
for _ in $(seq 1 24); do ready && { log "restore_ok" "\"snapshot\":\"$SNAP\""; exit 0; }; sleep 5; done
die "restored, but the site did not become ready"
