#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_DIR="${NAVIPROXY_ENV_DIR:-/etc/naviproxy}"
ENV_FILE="${NAVIPROXY_ENV_FILE:-$ENV_DIR/naviproxy.env}"
SERVICE_NAME="${NAVIPROXY_SERVICE_NAME:-naviproxy}"
SERVICE_FILE="/etc/systemd/system/$SERVICE_NAME.service"
SERVICE_USER="${NAVIPROXY_SERVICE_USER:-naviproxy}"
SERVICE_GROUP="${NAVIPROXY_SERVICE_GROUP:-naviproxy}"

log() {
  printf '\n[naviproxy] %s\n' "$1"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

run_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif need_cmd sudo; then
    sudo "$@"
  else
    log "This step needs root privileges. Please install sudo or run as root."
    exit 1
  fi
}

require_systemd() {
  if ! need_cmd systemctl; then
    log "systemctl was not found. Autostart needs systemd."
    exit 1
  fi
}

ensure_env() {
  if [ ! -f "$ENV_FILE" ]; then
    log "Environment file not found. Running install.sh first..."
    "$ROOT_DIR/install.sh"
  fi
}

ensure_service_user() {
  if ! getent group "$SERVICE_GROUP" >/dev/null 2>&1; then
    run_root groupadd --system "$SERVICE_GROUP"
  fi

  if ! id "$SERVICE_USER" >/dev/null 2>&1; then
    run_root useradd --system --home "$ROOT_DIR" --shell /usr/sbin/nologin --gid "$SERVICE_GROUP" "$SERVICE_USER"
  fi
}

write_service() {
  log "Writing systemd service to $SERVICE_FILE..."
  cat >"$ROOT_DIR/.naviproxy.service.tmp" <<EOF
[Unit]
Description=NaviProxy dashboard and reverse proxy controller
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$ROOT_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$ROOT_DIR/start.sh
Restart=on-failure
RestartSec=5
User=$SERVICE_USER
Group=$SERVICE_GROUP

[Install]
WantedBy=multi-user.target
EOF
  run_root mv "$ROOT_DIR/.naviproxy.service.tmp" "$SERVICE_FILE"
}

prepare_permissions() {
  log "Preparing service permissions..."
  chmod +x "$ROOT_DIR/install.sh" "$ROOT_DIR/start.sh" "$ROOT_DIR/enable-autostart.sh"

  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a

  DATA_PATH="${DATABASE_PATH:-$ROOT_DIR/data/naviproxy.sqlite}"
  DATA_DIR="$(dirname "$DATA_PATH")"
  run_root mkdir -p "$DATA_DIR"
  run_root chown -R "$SERVICE_USER:$SERVICE_GROUP" "$DATA_DIR"
}

enable_service() {
  log "Enabling and starting $SERVICE_NAME.service..."
  run_root systemctl daemon-reload
  run_root systemctl enable --now "$SERVICE_NAME.service"
  run_root systemctl status "$SERVICE_NAME.service" --no-pager --lines=12
}

main() {
  require_systemd
  ensure_env
  ensure_service_user
  write_service
  prepare_permissions
  enable_service

  log "Autostart enabled."
}

main "$@"
