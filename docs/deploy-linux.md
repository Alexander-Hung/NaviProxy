# Deploy NaviProxy on a Linux Mini PC

This guide assumes Debian or Ubuntu. Adjust package commands for other distributions.

## Fast Path

```bash
git clone https://github.com/Alexander-Hung/NaviProxy /opt/naviproxy
cd /opt/naviproxy
./install.sh
./start.sh
```

`install.sh` installs system packages on Debian/Ubuntu, installs Node.js 22 when needed, installs Caddy when missing, runs `npm ci`, builds the app, prepares `/etc/naviproxy/naviproxy.env`, and reloads Caddy. If `apt` cannot locate `caddy`, the script adds Caddy's official apt repository and retries.

`start.sh` loads `/etc/naviproxy/naviproxy.env`, verifies build output, starts Caddy if systemd is available, and starts NaviProxy.

Enable boot autostart:

```bash
./enable-autostart.sh
```

That writes `/etc/systemd/system/naviproxy.service`, creates the `naviproxy` system user when needed, enables the service, and starts it immediately.

## Manual Install

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
git clone https://github.com/Alexander-Hung/NaviProxy /opt/naviproxy
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
ADMIN_TOKEN=
DASHBOARD_AUTH_REQUIRED=false
CORS_ORIGIN=
DATABASE_PATH=/opt/naviproxy/data/naviproxy.sqlite
WEB_DIST_PATH=/opt/naviproxy/apps/web/dist
CADDY_ADMIN_URL=http://127.0.0.1:2019
CADDY_SYNC_ENABLED=true
CADDY_LISTEN=:80
NAVIPROXY_DASHBOARD_TARGET_URL=http://127.0.0.1:3001
```

Set `ADMIN_TOKEN` to require a token before anyone can create, edit, delete,
import, export, reorder, or sync services from the admin UI. Set
`DASHBOARD_AUTH_REQUIRED=true` to protect the read-only dashboard list too.
Leave tokens empty only for trusted local development. `CORS_ORIGIN` can be left
empty for same-origin dashboard usage, set to `*` for permissive development, or
set to a comma-separated list of allowed origins.

## 4. Enable Caddy Admin API

Create or update `/etc/caddy/Caddyfile`:

```caddyfile
{
	admin 127.0.0.1:2019 {
		origins localhost:2019 127.0.0.1:2019 [::1]:2019
	}
}

:80 {
	reverse_proxy 127.0.0.1:3001
}
```

Then reload Caddy:

```bash
sudo systemctl reload caddy
```

If port 80 still shows an old Caddy placeholder page, run:

```bash
./repair-caddy.sh
```

If Caddy returns `502`, run:

```bash
./repair-caddy.sh
./doctor.sh
```

## 5. Run as a systemd service

```bash
./enable-autostart.sh
```

Check status:

```bash
systemctl status naviproxy
curl http://127.0.0.1:3001/api/health
```

Open:

```txt
http://<MINI_PC_IP>
```

Caddy listens on port `80` and forwards NaviProxy dashboard traffic to the Node service on `3001`, so you do not need to type a port in the browser.

After adding a subdomain app such as `jellyfin.lab.home`, point that name to the mini PC IP in your router DNS, Pi-hole, AdGuard Home, or local DNS server.

Subdomains are written app-first. For Homebridge, use:

```txt
homebridge.lab.home
```

Do not use:

```txt
lab.home.homebridge
```

If your local DNS only has `lab.home -> <MINI_PC_IP>`, that only covers the dashboard host. Add either:

```txt
homebridge.lab.home -> <MINI_PC_IP>
```

or a wildcard record:

```txt
*.lab.home -> <MINI_PC_IP>
```

## Notes

- Subdomain mode is recommended.
- Use LAN target URL origins like `http://192.168.1.20:8096`, without path,
  query, or hash components.
- Use the Admin page local service scan to discover software already listening
  on the NaviProxy host and prefill app targets from those ports.
- Keep Caddy Admin API bound to `127.0.0.1`.
- If you use port `80` for proxied apps, keep NaviProxy itself on `3001`.
- Back up `/opt/naviproxy/data/naviproxy.sqlite`, or use the admin UI export
  button to save a JSON copy of configured apps.
