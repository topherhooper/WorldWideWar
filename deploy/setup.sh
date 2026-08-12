#!/usr/bin/env bash
#
# Turns a bare Debian VM into a running World Wide War server.
#
# Idempotent: safe to re-run after a code change, which is also how you deploy.
#
#   sudo WWW_DOMAIN=play.example.com ./deploy/setup.sh
#
# What it does NOT do: create the VM, open the firewall, or point DNS at it.
# Those are one-time steps and they belong to your cloud account, not a script
# in a repository. See deploy/README.md.

set -euo pipefail

DOMAIN="${WWW_DOMAIN:-}"
REPO="${WWW_REPO:-https://github.com/topherhooper/WorldWideWar.git}"
BRANCH="${WWW_BRANCH:-main}"
APP_DIR=/opt/worldwidewar
SERVICE_USER=worldwidewar

if [[ -z "$DOMAIN" ]]; then
  echo "WWW_DOMAIN is required, e.g. WWW_DOMAIN=play.example.com $0" >&2
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run me with sudo" >&2
  exit 1
fi

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

say "Installing Node 22, Caddy and git"
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1)" != "v22" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -qq
  apt-get install -y -qq caddy
fi

corepack enable
corepack prepare pnpm@latest --activate

say "Creating the service account"
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  # No login shell and no home: this account exists to own one process.
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

say "Fetching the code"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$APP_DIR"
fi

say "Building"
cd "$APP_DIR"
pnpm install --frozen-lockfile
pnpm build
# The service account only ever reads this tree; game state lives elsewhere.
chown -R root:root "$APP_DIR"

say "Installing the service"
install -m 0644 "$APP_DIR/deploy/worldwidewar.service" /etc/systemd/system/worldwidewar.service
systemctl daemon-reload
systemctl enable worldwidewar
systemctl restart worldwidewar

say "Configuring Caddy for $DOMAIN"
install -m 0644 "$APP_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile
mkdir -p /etc/systemd/system/caddy.service.d
cat >/etc/systemd/system/caddy.service.d/domain.conf <<EOF
[Service]
Environment=WWW_DOMAIN=$DOMAIN
EOF
systemctl daemon-reload
systemctl enable caddy
systemctl restart caddy

say "Waiting for the server to answer"
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8787/ >/dev/null 2>&1; then
    say "Up: https://$DOMAIN"
    systemctl --no-pager --lines=5 status worldwidewar || true
    exit 0
  fi
  sleep 1
done

echo "the server did not answer in time — check: journalctl -u worldwidewar -n 50" >&2
exit 1
