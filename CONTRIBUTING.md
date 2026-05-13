# Contributing to NaviProxy

Thank you for your interest in improving NaviProxy.

## Project Language

Public repository content must be written in English. This includes code comments, documentation, issues, pull requests, commit messages, release notes, and templates.

Local private notes may exist in ignored files, but they should not be committed.

## Development Setup

```bash
npm install
npm run dev
```

Default development URLs:

- Web: `http://localhost:5173`
- API: `http://localhost:3001`

## Checks Before Opening a Pull Request

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

For UI changes, also run:

```bash
npm run test:e2e
```

## Contribution Guidelines

- Keep changes focused and reviewable.
- Follow existing project patterns before adding new abstractions.
- Prefer small, explicit behavior over broad rewrites.
- Add tests when changing deploy parsing, Docker/Compose behavior, Caddy rendering, app lifecycle, auth, or database contracts.
- Do not commit local database files, environment files, generated build output, or private notes.
- Public docs and code comments must stay English-only.

## Deploy Feature Guidelines

Changes to deploy behavior must consider:

- macOS, Linux, and Windows path formats.
- Docker Desktop, Colima, Linux Docker, rootless Docker, and custom `DOCKER_BIN`.
- Missing Docker CLI.
- Unreachable Docker daemon.
- Broken Docker credential helpers.
- Docker Compose plugin and legacy `docker-compose`.
- Port conflicts and privileged ports.
- Bind mount permissions.
- Host networking.
- Privileged containers, capabilities, devices, and Docker socket mounts.
- Managed deployment cleanup when an app is deleted.

## Commit Style

Use concise, imperative commit messages:

```txt
Add Docker Compose host permission checks
Fix Windows bind mount parsing
Document release process
```

## Reporting Issues

When reporting a bug, include:

- Operating system.
- Node.js version.
- Docker version.
- Docker Compose version.
- Whether Docker Desktop, Colima, rootless Docker, or Linux Docker is used.
- Relevant command or Compose file with secrets removed.
- Error message from the UI or API logs.
