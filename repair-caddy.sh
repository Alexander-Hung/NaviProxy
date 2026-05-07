#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${NAVIPROXY_ENV_FILE:-/etc/naviproxy/naviproxy.env}"
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

load_env() {
  if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
  fi
}

install_caddyfile() {
  if [ ! -f "$ROOT_DIR/caddy/Caddyfile" ]; then
    log "Missing $ROOT_DIR/caddy/Caddyfile"
    exit 1
  fi

  log "Installing Caddyfile to /etc/caddy/Caddyfile..."
  run_root mkdir -p /etc/caddy
  run_root cp "$ROOT_DIR/caddy/Caddyfile" /etc/caddy/Caddyfile
}

ensure_build() {
  log "Installing dependencies and building NaviProxy..."
  cd "$ROOT_DIR"
  npm ci
  npm run build
}

ensure_service() {
  if ! need_cmd systemctl; then
    return
  fi

  log "Ensuring NaviProxy systemd service is configured..."
  "$ROOT_DIR/enable-autostart.sh" >/dev/null
}

fix_permissions() {
  local data_path="${DATABASE_PATH:-$ROOT_DIR/data/naviproxy.sqlite}"
  local data_dir
  data_dir="$(dirname "$data_path")"

  run_root mkdir -p "$data_dir"

  if getent group "$SERVICE_GROUP" >/dev/null 2>&1 && id "$SERVICE_USER" >/dev/null 2>&1; then
    run_root chown -R "$SERVICE_USER:$SERVICE_GROUP" "$data_dir"
  fi
}

restart_caddy() {
  if ! need_cmd systemctl || ! systemctl list-unit-files caddy.service >/dev/null 2>&1; then
    log "Caddy systemd service was not found. Please restart Caddy manually."
    return
  fi

  log "Restarting Caddy..."
  run_root systemctl restart caddy
}

restart_naviproxy() {
  if ! need_cmd systemctl || ! systemctl list-unit-files naviproxy.service >/dev/null 2>&1; then
    return
  fi

  log "Restarting NaviProxy..."
  run_root systemctl restart naviproxy
}

sync_proxy() {
  if ! need_cmd curl; then
    return
  fi

  local port="${PORT:-3001}"
  log "Waiting for NaviProxy API on port $port..."
  for _ in $(seq 1 20); do
    if curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
      log "Syncing Caddy routes from NaviProxy..."
      curl -fsS -X POST "http://127.0.0.1:$port/api/proxy/sync" >/dev/null || true
      return
    fi
    sleep 1
  done

  log "NaviProxy API did not become ready. Start it, then click Sync in the admin panel."
}

main() {
  load_env
  ensure_build
  install_caddyfile
  fix_permissions
  ensure_service
  restart_naviproxy
  restart_caddy
  sync_proxy

  log "Caddy repair complete. Open http://<MINI_PC_IP>"
}

main "$@"
