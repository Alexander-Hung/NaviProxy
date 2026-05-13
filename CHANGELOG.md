# Changelog

All notable changes to NaviProxy will be documented in this file.

This project follows [Semantic Versioning](https://semver.org/) while it is public-facing. During `0.x`, breaking changes may still happen, but they should be documented clearly in release notes.

## [Unreleased]

### Added

- Docker run deployment flow with command parsing, automatic port assignment, host permission checks, and managed cleanup.
- Docker Compose deployment flow with YAML parsing, web service selection, port inference, bind mount checks, host network handling, and managed cleanup.
- Host permission panel for Docker runtime, Compose runtime, bind mounts, privileged containers, capabilities, devices, host networking, Docker socket mounts, public domain DNS, and Caddy sync.
- Public domain plus reverse proxy deploy mode.
- Managed deployment records for self-hosted apps.

### Changed

- README now describes NaviProxy as a dashboard, reverse proxy controller, and self-host deployment manager.

## [0.1.0] - 2026-05-13

### Added

- Initial homelab dashboard and reverse proxy controller.
- App management with categories, tags, favorites, ordering, import/export, backup/restore, audit logs, and health checks.
- Caddy Admin API sync.
- Local service discovery and DNS diagnostics.
- Linux deployment guide.
