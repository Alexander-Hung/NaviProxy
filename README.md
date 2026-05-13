# NaviProxy

NaviProxy is a lightweight homelab dashboard, reverse proxy controller, and self-host deployment manager. It gives users one place to register existing services, deploy Docker-based apps, assign ports, bind routes, check health, and keep Caddy reverse proxy configuration in sync.

The project is designed for mini PCs, NAS boxes, Raspberry Pi hosts, home servers, and small cloud machines. It treats services as plain HTTP upstreams, so Docker, Docker Compose, bare-metal processes, NAS apps, and LAN devices can all appear in the same dashboard.

## Current Status

Available now:

- App dashboard with categories, tags, favorites, ordering, and health status.
- Admin panel for app CRUD, import/export, backup/restore, settings, audits, diagnostics, and proxy sync.
- Caddy Admin API integration for generated reverse proxy configuration.
- Subdomain and subpath routing modes. Subdomain mode is recommended.
- Local service discovery for ports already listening on the NaviProxy host.
- DNS diagnostics for route and public domain checks.
- Docker run deployments with command parsing, automatic port assignment, permission checks, and managed cleanup.
- Docker Compose deployments with YAML parsing, web service selection, port inference, bind mount checks, host network handling, and managed cleanup.
- Host permission panel for Docker CLI, Docker daemon, Compose runtime, bind mounts, privileged containers, capabilities, devices, host networking, Docker socket mounts, public domain DNS, and Caddy sync.
- Managed deployment records. Apps deployed by NaviProxy are marked as managed and are cleaned up when deleted.

Planned:

- GitHub auto-detect deployments.
- Static site deployments.
- Node.js app deployments.
- Python app deployments.
- Binary or service deployments.
- Advanced custom command deployments.
- Multi-host or agent-based management.

## Stack

- Web: React, Vite, TailwindCSS
- API: Node.js, Fastify
- Database: SQLite
- Reverse proxy: Caddy Admin API
- Deploy runtime: Docker CLI and Docker Compose

## Development

```bash
npm install
npm run dev
```

Default development URLs:

- Web: `http://localhost:5173`
- API: `http://localhost:3001`

## Production Build

```bash
npm ci
npm run build
npm start
```

The production API serves both `/api/*` and the built web dashboard.

## Linux Deployment

See [docs/deploy-linux.md](docs/deploy-linux.md) for the Debian/Ubuntu mini PC deployment path using Node.js, SQLite, Caddy, and systemd.

Fast path after cloning the repository:

```bash
./install.sh
./start.sh
```

## Environment

Common production variables:

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
DOCKER_BIN=docker
DEPLOYMENTS_PATH=/opt/naviproxy/data/deployments
HEALTH_CHECK_INTERVAL_SECONDS=0
NAVIPROXY_DASHBOARD_TARGET_URL=http://127.0.0.1:3001
```

For production, set a strong `ADMIN_TOKEN`. Set `DASHBOARD_AUTH_REQUIRED=true` if the read-only dashboard should also require authentication.

## Deployments

NaviProxy can deploy from:

- `docker run` commands
- Docker Compose YAML

The deploy flow is:

1. Paste a command or Compose file.
2. NaviProxy auto-fills app name, route host, and ports when possible.
3. Review Host permission checks.
4. Preview the deployment plan.
5. Deploy.
6. NaviProxy creates the app route and saves a managed deployment record.

When a managed app is deleted, NaviProxy attempts to remove the related Docker container or Compose project and free the route.

## Important Safety Model

NaviProxy automates common deployment work, but it does not bypass operating system permissions.

It can automatically:

- Allocate safe high ports.
- Create normal writable bind mount paths.
- Write managed Compose files.
- Call Docker and Docker Compose.
- Sync Caddy routes.
- Remove managed containers or Compose projects.

It will not silently:

- Run `sudo`.
- Change Docker socket permissions.
- Modify router port forwarding.
- Change public DNS records.
- Expose Caddy Admin API to the public internet.
- Override protected host paths without user action.

Host permission checks are shown before deploy so users can see what is ready, what NaviProxy can handle, and what needs manual host authorization.

## Testing

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run test:e2e
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and pull request guidelines.

Security reports should follow [SECURITY.md](SECURITY.md).

Release preparation is documented in [RELEASE.md](RELEASE.md), and user-facing changes are tracked in [CHANGELOG.md](CHANGELOG.md).

## License

NaviProxy is released under the [MIT License](LICENSE).

## Notes for Maintainers

Public repository content should be written in English. Local personal planning notes under `docs/*.md` are ignored by git, except for `docs/deploy-linux.md`, which is the public Linux deployment guide.
