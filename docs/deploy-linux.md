# Deploy NaviProxy on a Linux Mini PC

This guide assumes Debian or Ubuntu. Adjust package commands for other distributions.

## 1. Install runtime dependencies

```bash
sudo apt update
sudo apt install -y git curl build-essential caddy
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

`better-sqlite3` is a native dependency, so `build-essential` is required during install.

## 2. Download and build

```bash
sudo mkdir -p /opt/naviproxy
sudo chown "$USER":"$USER" /opt/naviproxy
git clone <YOUR_REPO_URL> /opt/naviproxy
cd /opt/naviproxy
npm ci
npm run build
```

## 3. Configure NaviProxy

```bash
sudo useradd --system --home /opt/naviproxy --shell /usr/sbin/nologin naviproxy
sudo mkdir -p /etc/naviproxy /opt/naviproxy/data
sudo cp .env.example /etc/naviproxy/naviproxy.env
sudo chown -R naviproxy:naviproxy /opt/naviproxy/data
```

Edit `/etc/naviproxy/naviproxy.env`:

```env
HOST=0.0.0.0
PORT=3001
DATABASE_PATH=/opt/naviproxy/data/naviproxy.sqlite
WEB_DIST_PATH=/opt/naviproxy/apps/web/dist
CADDY_ADMIN_URL=http://127.0.0.1:2019
CADDY_SYNC_ENABLED=true
CADDY_LISTEN=:80
```

## 4. Enable Caddy Admin API

Create or update `/etc/caddy/Caddyfile`:

```caddyfile
{
	admin 127.0.0.1:2019
}

:80 {
	respond "NaviProxy Caddy is ready."
}
```

Then reload Caddy:

```bash
sudo systemctl reload caddy
```

## 5. Run as a systemd service

```bash
sudo cp deploy/naviproxy.service /etc/systemd/system/naviproxy.service
sudo chown -R naviproxy:naviproxy /opt/naviproxy
sudo systemctl daemon-reload
sudo systemctl enable --now naviproxy
```

Check status:

```bash
systemctl status naviproxy
curl http://127.0.0.1:3001/api/health
```

Open:

```txt
http://<MINI_PC_IP>:3001
```

After adding a subdomain app such as `jellyfin.lab.home`, point that name to the mini PC IP in your router DNS, Pi-hole, AdGuard Home, or local DNS server.

## Notes

- Subdomain mode is recommended.
- Keep Caddy Admin API bound to `127.0.0.1`.
- If you use port `80` for proxied apps, keep NaviProxy itself on `3001`.
- Back up `/opt/naviproxy/data/naviproxy.sqlite`.
