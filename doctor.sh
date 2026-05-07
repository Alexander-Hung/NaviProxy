#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${NAVIPROXY_ENV_FILE:-/etc/naviproxy/naviproxy.env}"

section() {
  printf '\n== %s ==\n' "$1"
}

load_env() {
  if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
  fi
}

show_cmd() {
  printf '\n$ %s\n' "$*"
  "$@" || true
}

main() {
  load_env
  local port="${PORT:-3001}"

  section "Environment"
  printf 'ROOT_DIR=%s\n' "$ROOT_DIR"
  printf 'ENV_FILE=%s\n' "$ENV_FILE"
  printf 'PORT=%s\n' "$port"
  printf 'CADDY_LISTEN=%s\n' "${CADDY_LISTEN:-:80}"
  printf 'NAVIPROXY_DASHBOARD_TARGET_URL=%s\n' "${NAVIPROXY_DASHBOARD_TARGET_URL:-http://127.0.0.1:$port}"

  section "Files"
  show_cmd ls -la "$ROOT_DIR/apps/api/dist/server.js"
  show_cmd ls -la "$ROOT_DIR/apps/web/dist/index.html"
  show_cmd sed -n '1,80p' /etc/caddy/Caddyfile

  section "Services"
  if command -v systemctl >/dev/null 2>&1; then
    show_cmd systemctl --no-pager --lines=8 status naviproxy
    show_cmd systemctl --no-pager --lines=8 status caddy
  fi

  section "HTTP"
  if command -v curl >/dev/null 2>&1; then
    show_cmd curl -i "http://127.0.0.1:$port/api/health"
    show_cmd curl -I http://127.0.0.1/
  fi

  section "Recent Logs"
  if command -v journalctl >/dev/null 2>&1; then
    show_cmd journalctl -u naviproxy -n 40 --no-pager
    show_cmd journalctl -u caddy -n 40 --no-pager
  fi
}

main "$@"
