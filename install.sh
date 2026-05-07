#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_DIR="${NAVIPROXY_ENV_DIR:-/etc/naviproxy}"
ENV_FILE="${NAVIPROXY_ENV_FILE:-$ENV_DIR/naviproxy.env}"
DATA_DIR="${NAVIPROXY_DATA_DIR:-$ROOT_DIR/data}"

log() {
  printf '\n[naviproxy] %s\n' "$1"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

has_sudo() {
  need_cmd sudo
}

run_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif has_sudo; then
    sudo "$@"
  else
    log "This step needs root privileges. Please install sudo or run as root."
    exit 1
  fi
}

node_major() {
  if need_cmd node; then
    node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0
  else
    echo 0
  fi
}

install_debian_packages() {
  log "Installing Linux packages with apt..."
  run_root apt-get update
  run_root apt-get install -y ca-certificates curl git build-essential

  if [ "$(node_major)" -lt 22 ]; then
    log "Installing Node.js 22..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | run_root bash -
    run_root apt-get install -y nodejs
  fi

  if ! need_cmd caddy; then
    log "Installing Caddy..."
    if ! run_root apt-get install -y caddy; then
      log "Caddy was not found in the default apt sources. Adding the official Caddy repository..."
      run_root apt-get install -y debian-keyring debian-archive-keyring apt-transport-https gnupg
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | run_root gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | run_root tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
      run_root apt-get update
      run_root apt-get install -y caddy
    fi
  fi
}

install_packages() {
  if [ "$(uname -s)" != "Linux" ]; then
    log "Non-Linux system detected. Skipping system package installation."
    return
  fi

  if need_cmd apt-get; then
    install_debian_packages
    return
  fi

  log "Unsupported package manager. Please install Node.js 22, npm, Caddy, git, and build tools manually."
}

write_env() {
  log "Preparing environment file..."
  run_root mkdir -p "$ENV_DIR"
  mkdir -p "$DATA_DIR"

  if [ ! -f "$ENV_FILE" ]; then
    cat >"$ROOT_DIR/.naviproxy.env.tmp" <<EOF
HOST=0.0.0.0
PORT=3001
DATABASE_PATH=$DATA_DIR/naviproxy.sqlite
WEB_DIST_PATH=$ROOT_DIR/apps/web/dist
CADDY_ADMIN_URL=http://127.0.0.1:2019
CADDY_SYNC_ENABLED=true
CADDY_LISTEN=:80
NAVIPROXY_DASHBOARD_TARGET_URL=http://127.0.0.1:3001
EOF
    run_root mv "$ROOT_DIR/.naviproxy.env.tmp" "$ENV_FILE"
  fi
}

configure_caddy() {
  if ! need_cmd caddy; then
    log "Caddy is not installed. Skipping Caddy configuration."
    return
  fi

  if [ -d /etc/caddy ]; then
    log "Installing NaviProxy Caddyfile..."
    run_root cp "$ROOT_DIR/caddy/Caddyfile" /etc/caddy/Caddyfile
    if need_cmd systemctl && systemctl list-unit-files caddy.service >/dev/null 2>&1; then
      run_root systemctl enable caddy >/dev/null 2>&1 || true
      run_root systemctl reload caddy >/dev/null 2>&1 || run_root systemctl restart caddy
    fi
  fi
}

install_node_modules() {
  log "Installing Node dependencies..."
  cd "$ROOT_DIR"
  npm ci

  log "Building NaviProxy..."
  npm run build
}

main() {
  log "Starting NaviProxy one-click install..."
  install_packages
  install_node_modules
  write_env
  configure_caddy

  log "Install complete."
  log "Start with: ./start.sh"
  log "Enable autostart with: ./enable-autostart.sh"
  log "Repair Caddy routing with: ./repair-caddy.sh"
}

main "$@"
