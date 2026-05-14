# Migration Checklist

Use this checklist when moving The Containers to a new mini PC, NAS, server, or cloud host.

## What the Admin Backup Contains

The Admin backup export contains:

- App records.
- Settings.
- Managed deployment records.
- Saved redeploy metadata for deployments created by The Containers.
- Managed deployment files, including Compose project files under `DEPLOYMENTS_PATH`.
- Readable Docker bind mount and named volume data discovered from managed Docker containers.

It does not contain:

- Docker named volume data.
- Bind-mounted app data directories.
- Unreadable Docker Desktop VM volume paths.
- Skipped large files beyond backup limits.
- External databases.
- Router port forwarding rules.
- Public DNS records.
- TLS certificates managed outside Caddy.

## Before Migration

1. Export a backup from the Admin page.
2. Back up the SQLite database:

   ```bash
   cp /opt/the-containers/data/the-containers.sqlite /tmp/the-containers.sqlite.backup
   ```

3. Back up managed Compose project files:

   ```bash
   tar -czf /tmp/the-containers-deployments.tgz -C /opt/the-containers/data deployments
   ```

4. Back up app data directories used by bind mounts.
5. Back up Docker named volumes for important services.
6. Record public DNS, local DNS, router forwarding, Cloudflare Tunnel, and reverse proxy settings.
7. Record apps that use authentication callbacks, origin checks, or fixed public domains.

## Important App Data

Treat these as data-critical services:

- Homebridge.
- qBittorrent.
- Password vaults.
- Databases.
- File sharing and pastebin services.
- Any app using bind mounts or Docker named volumes.

Before migration, identify each app's data path or Docker volume. The Containers can restore deployment metadata, but it cannot recreate missing application data.

## Restore on the New Host

1. Install Docker, Docker Compose, Caddy, Node.js, and The Containers.
2. Restore `/opt/the-containers/data/the-containers.sqlite` if you are doing a full database restore.
3. Restore deployment project files under `DEPLOYMENTS_PATH`.
4. Restore Docker volumes and bind mount directories.
5. Start The Containers.
6. Import the Admin backup if you did not restore the full SQLite database.
7. Run proxy sync from Admin.
8. Open each managed app detail view and run deployment drift check.
9. Use repair actions only after confirming the app data path exists on the new host.
10. Redeploy only after reviewing the redeploy preview.

## Post-Migration Verification

For every managed app, verify:

- The app has the `Self-Host` badge.
- Deployment status is present.
- Drift check is `pass`, or warnings are understood.
- Logs are available.
- Public route opens correctly.
- Reverse proxy route points to the expected target.
- Data is present inside the app.
- Redeploy preview shows expected image, port, and preserved data.

For public domains, verify:

- DNS points to the new host or tunnel.
- Port forwarding points to the new host.
- Caddy can receive traffic.
- Apps that enforce origin or callback URLs have been updated.

## Rollback

Keep the old host powered off but unchanged until the new host is verified. If the new host fails verification:

1. Stop The Containers on the new host.
2. Restore DNS or router forwarding to the old host.
3. Start the old host services.
4. Review The Containers audit logs to see what changed during migration.
