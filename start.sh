#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${NAVIPROXY_ENV_FILE:-/etc/naviproxy/naviproxy.env}"

log() {
  printf '\n[naviproxy] %s\n' "$1"
}

load_env() {
  if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
  elif [ -f "$ROOT_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$ROOT_DIR/.env"
    set +a
  else
    log "No env file found. Run ./install.sh first, or copy .env.example to .env."
  fi
}

ensure_built() {
  if [ ! -f "$ROOT_DIR/apps/api/dist/server.js" ] || [ ! -f "$ROOT_DIR/apps/web/dist/index.html" ]; then
    log "Build output missing. Running npm run build..."
    cd "$ROOT_DIR"
    npm run build
  fi
}

start_caddy_if_available() {
  if ! command -v caddy >/dev/null 2>&1; then
    return
  fi

  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files caddy.service >/dev/null 2>&1; then
    if ! systemctl is-active --quiet caddy; then
      log "Starting Caddy service..."
      sudo systemctl start caddy || true
    fi
  fi
}

main() {
  load_env
  ensure_built
  start_caddy_if_available

  log "Starting NaviProxy..."
  HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || echo localhost)"
  if [ "${CADDY_LISTEN:-:80}" = ":80" ]; then
    log "Open: http://$HOST_IP"
    log "Direct API fallback: http://$HOST_IP:${PORT:-3001}"
  else
    log "Open: http://$HOST_IP:${PORT:-3001}"
  fi
  cd "$ROOT_DIR"
  npm start
}

main "$@"
