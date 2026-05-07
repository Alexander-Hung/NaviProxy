# NaviProxy

NaviProxy is a lightweight homelab dashboard and reverse proxy gateway. It keeps the target services independent: Docker, bare metal, NAS apps, Raspberry Pi services, and anything else are treated as plain `IP:Port` upstreams.

## Stack

- Web: React, Vite, TailwindCSS
- API: Node.js, Fastify
- Database: SQLite
- Proxy engine: Caddy Admin API

## Development

```bash
npm install
npm run dev
```

The web app runs at `http://localhost:5173`.
The API runs at `http://localhost:3001`.

## Linux Deployment

See [docs/deploy-linux.md](docs/deploy-linux.md) for the mini PC deployment path using Node.js, SQLite, Caddy, and systemd.

One-click install and start after cloning the repo:

```bash
./install.sh
./start.sh
```

Enable boot autostart:

```bash
./enable-autostart.sh
```

Manual production build:

```bash
npm ci
npm run build
npm start
```

The production API serves both `/api/*` and the built web dashboard.
With Caddy enabled, open NaviProxy at `http://<MINI_PC_IP>` without a port. Caddy listens on port `80` and forwards dashboard traffic to the API service on `3001`.

By default, Caddy sync is disabled for local development. To enable live Caddy updates:

```bash
CADDY_SYNC_ENABLED=true CADDY_ADMIN_URL=http://127.0.0.1:2019 npm run dev -w @naviproxy/api
```

## First MVP Behavior

- Add apps from the admin panel.
- Subdomain mode is the recommended path, for example `jellyfin.lab.home`.
- Subpath mode is available, but the UI warns that it may break static assets, redirects, cookies, WebSockets, or OAuth callbacks.
- Enabled apps are written to SQLite.
- When Caddy sync is enabled, NaviProxy renders a Caddy JSON config and posts it to `/load`.
