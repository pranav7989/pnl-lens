#!/usr/bin/env bash
# @file  infra/scripts/healthcheck.sh
# @area  Ops
# @what  Cron every 5 minutes: site readiness and disk space; emails ALERT_EMAIL (via Resend) when something goes wrong, and once when it recovers.
# shellcheck source=infra/scripts/lib.sh
. "$(dirname "$0")/lib.sh"
load_env
STATE="$ROOT/.deploy/health.state"; mkdir -p "$ROOT/.deploy"
problems=()
ready || problems+=("site not ready: https://${DOMAIN}/api/v1/ready failed")
for mount in / "$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"; do
  [ -d "$mount" ] || continue
  use=$(df -P "$mount" | awk 'NR==2 {gsub("%","",$5); print $5}')
  [ "${use:-0}" -ge 85 ] && problems+=("disk ${mount} at ${use}%")
done
before="$(cat "$STATE" 2>/dev/null || echo ok)"
now="ok"; [ "${#problems[@]}" -gt 0 ] && now="$(printf '%s; ' "${problems[@]}")"
send() {
  [ -n "${RESEND_API_KEY:-}" ] && [ -n "${ALERT_EMAIL:-}" ] || { log "alert_not_sent" "\"reason\":\"RESEND_API_KEY or ALERT_EMAIL missing\""; return; }
  curl -fsS --max-time 10 https://api.resend.com/emails -H "Authorization: Bearer ${RESEND_API_KEY}" -H 'Content-Type: application/json' \
    -d "$(jq -n --arg from "${MAIL_FROM:-PnL Lens <no-reply@pnllens.com>}" --arg to "$ALERT_EMAIL" --arg s "$1" --arg t "$2" '{from:$from,to:[$to],subject:$s,text:$t}')" >/dev/null \
    || log "alert_failed"
}
if [ "$now" != "ok" ] && [ "$now" != "$before" ]; then
  send "PnL Lens alert: ${DOMAIN}" "$now"; log "alert" "\"problems\":\"${now//\"/}\""
elif [ "$now" = "ok" ] && [ "$before" != "ok" ]; then
  send "PnL Lens recovered: ${DOMAIN}" "All checks are passing again."; log "recovered"
fi
echo "$now" > "$STATE"
