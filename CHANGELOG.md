# Changelog

All notable changes to The Containers will be documented in this file.

This project follows [Semantic Versioning](https://semver.org/) while it is public-facing. During `0.x`, breaking changes may still happen, but they should be documented clearly in release notes.

## [Unreleased]

- No unreleased changes.

## [0.2.0] - 2026-05-13

### Added

- Docker run deployment flow with command parsing, automatic port assignment, host permission checks, and managed cleanup.
- Docker Compose deployment flow with YAML parsing, web service selection, port inference, bind mount checks, host network handling, and managed cleanup.
- Host permission panel for Docker runtime, Compose runtime, bind mounts, privileged containers, capabilities, devices, host networking, Docker socket mounts, public domain DNS, and Caddy sync.
- Public domain plus reverse proxy deploy mode.
- Managed deployment records for self-hosted apps.
- Managed deployment controls for start, stop, restart, logs, image pull, redeploy, and redeploy safety preview.
- Deployment drift checks for missing containers, stopped containers, missing Compose files, port mismatches, and missing redeploy metadata.
- Deployment drift repair actions for starting stopped deployments, redeploying missing managed resources, and updating app targets from runtime ports.
- Backup and restore support for managed deployment records and redeploy metadata.
- Backup bundle support for managed deployment files, readable Docker bind mount and named volume data, plus compatibility handling for older or differently shaped app export files.
- Migration checklist for moving The Containers to a new host.

### Changed

- README now describes The Containers as a dashboard, reverse proxy controller, and self-host deployment manager.
- Backup export format version is now `2` and includes deployment metadata.

## [0.1.0] - 2026-05-13

### Added

- Initial homelab dashboard and reverse proxy controller.
- App management with categories, tags, favorites, ordering, import/export, backup/restore, audit logs, and health checks.
- Caddy Admin API sync.
- Local service discovery and DNS diagnostics.
- Linux deployment guide.
