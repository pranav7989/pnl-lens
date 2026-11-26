#!/usr/bin/env bash
# @file  infra/scripts/provision.sh
# @area  Ops
# @what  Fresh Ubuntu 24.04 → ready server: Docker + compose, deploy user, SSH keys only, ufw, fail2ban, unattended upgrades, swap, log rotation, cron jobs.
#
# Run once as root (safe to re-run):   sudo bash infra/scripts/provision.sh
# Options (environment variables):
#   DEPLOY_USER=deploy        user that owns /srv/pnl-lens and runs deploy/backup (gets root's SSH keys if it has none)
#   DOCKER_DATA_ROOT=/mnt/... put Docker's data (database, files) on an attached block volume
#   SWAP_GB=4                 swap file size
# Note: Docker publishes ports through its own iptables rules, which bypass ufw. Only Caddy publishes 80/443 (meant
# to be public). To accept HTTPS from Cloudflare only, use the provider's cloud firewall (docs/DEPLOYMENT_VM.md).
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)"; exit 1; }
# shellcheck source=/dev/null
. /etc/os-release
[ "${ID}-${VERSION_ID}" = "ubuntu-24.04" ] || echo "warning: tested on Ubuntu 24.04, this is ${PRETTY_NAME}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
SWAP_GB="${SWAP_GB:-4}"
APP_DIR=/srv/pnl-lens
say() { echo "==> $*"; }

say "packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl gnupg ufw fail2ban unattended-upgrades git jq cron
timedatectl set-timezone Asia/Kolkata

say "docker"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
mkdir -p /etc/docker
DATA_ROOT_JSON=""
if [ -n "${DOCKER_DATA_ROOT:-}" ]; then mkdir -p "$DOCKER_DATA_ROOT"; DATA_ROOT_JSON="\"data-root\": \"${DOCKER_DATA_ROOT}\","; fi
cat > /etc/docker/daemon.json <<JSON
{ ${DATA_ROOT_JSON} "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" }, "live-restore": true }
JSON
systemctl enable --now docker
systemctl restart docker

say "deploy user"
id "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
if [ ! -s "/home/$DEPLOY_USER/.ssh/authorized_keys" ] && [ -s /root/.ssh/authorized_keys ]; then
  install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/authorized_keys"
fi
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"

say "ssh: keys only"
if [ -s "/home/$DEPLOY_USER/.ssh/authorized_keys" ]; then
  cat > /etc/ssh/sshd_config.d/99-pnl-lens.conf <<CONF
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
CONF
  systemctl reload ssh || systemctl reload sshd || true
else
  echo "   skipped: $DEPLOY_USER has no SSH key yet (add one, then re-run) — password login left as it is"
fi

say "firewall (ufw): 22, 80, 443"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

say "fail2ban (ssh)"
cat > /etc/fail2ban/jail.d/pnl-lens.local <<CONF
[sshd]
enabled = true
maxretry = 5
bantime = 1h
CONF
systemctl enable --now fail2ban
systemctl restart fail2ban

say "automatic security updates"
echo 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";' > /etc/apt/apt.conf.d/20auto-upgrades
systemctl enable --now unattended-upgrades

say "swap (${SWAP_GB} GB)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l "${SWAP_GB}G" /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -w vm.swappiness=10 >/dev/null; echo 'vm.swappiness=10' > /etc/sysctl.d/99-pnl-lens.conf

say "cron: nightly backup 03:00 IST, health check every 5 minutes"
cat > /etc/cron.d/pnl-lens <<CRON
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 3 * * * $DEPLOY_USER [ -f $APP_DIR/.env ] && $APP_DIR/infra/scripts/backup.sh >> /var/log/pnl-lens-backup.log 2>&1
*/5 * * * * $DEPLOY_USER [ -f $APP_DIR/.env ] && $APP_DIR/infra/scripts/healthcheck.sh >> /var/log/pnl-lens-health.log 2>&1
CRON
touch /var/log/pnl-lens-backup.log /var/log/pnl-lens-health.log
chown "$DEPLOY_USER" /var/log/pnl-lens-backup.log /var/log/pnl-lens-health.log

say "done. Next (as $DEPLOY_USER): clone the repo into $APP_DIR, create .env, run infra/scripts/deploy.sh — see docs/DEPLOYMENT_VM.md"
