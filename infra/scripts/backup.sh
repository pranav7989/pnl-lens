#!/usr/bin/env bash
# @file  infra/scripts/backup.sh
# @area  Ops
# @what  Nightly backup: Postgres dump + statements bucket → restic (encrypted, off-site); keeps 14 daily, 8 weekly, 12 monthly.
#
# Needs in .env: RESTIC_REPOSITORY, RESTIC_PASSWORD (+ AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY for an S3 repo such
# as DigitalOcean Spaces). A local path (e.g. /srv/backups/restic) works too (used by the restore drill).
# Statement objects are already encrypted per file; the file keys (FILE_KEK_*) are NOT in the backup — keep a copy
# of .env in a password manager or safe place, or the backup cannot be read back.
# shellcheck source=infra/scripts/lib.sh
. "$(dirname "$0")/lib.sh"
load_env
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY missing in .env}"; : "${RESTIC_PASSWORD:?RESTIC_PASSWORD missing in .env}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$ROOT/.backup/$STAMP"
mkdir -p "$WORK/statements"
trap 'rm -rf "$WORK"' EXIT
START=$(date +%s)

log "backup_start" "\"stamp\":\"$STAMP\""
PGPASSWORD="$POSTGRES_PASSWORD" dc exec -T -e PGPASSWORD postgres pg_dump -h 127.0.0.1 -U "${POSTGRES_USER:-lens_admin}" -d lens -Fc > "$WORK/db.dump"
[ -s "$WORK/db.dump" ] || die "empty database dump"
AWS_ACCESS_KEY_ID="$S3_WORKER_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$S3_WORKER_SECRET_ACCESS_KEY" \
  docker run --rm --network "$INTERNAL_NET" -v "$WORK/statements:/out" \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION=garage -e AWS_EC2_METADATA_DISABLED=true \
  "$AWS_IMAGE" --endpoint-url http://garage:3900 s3 sync s3://statements /out --only-show-errors

restic() {
  local mount=()
  case "$RESTIC_REPOSITORY" in /*) mkdir -p "$RESTIC_REPOSITORY"; mount=(-v "$RESTIC_REPOSITORY:$RESTIC_REPOSITORY") ;; esac
  docker run --rm -v "$WORK:/backup:ro" ${mount[@]+"${mount[@]}"} -e RESTIC_REPOSITORY -e RESTIC_PASSWORD -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
    --hostname pnl-lens "$RESTIC_IMAGE" "$@"
}
restic cat config >/dev/null 2>&1 || restic init
restic backup /backup --tag pnl-lens --host pnl-lens --quiet
restic forget --tag pnl-lens --host pnl-lens --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune --quiet
[ "$(date +%u)" = "7" ] && restic check --read-data-subset=5% --quiet
SIZE=$(du -sk "$WORK" | cut -f1)
log "backup_ok" "\"stamp\":\"$STAMP\",\"kb\":$SIZE,\"seconds\":$(( $(date +%s) - START ))"
