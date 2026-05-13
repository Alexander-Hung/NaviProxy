# Release Process

This document describes how to prepare NaviProxy releases.

## Versioning

NaviProxy uses Semantic Versioning:

```txt
MAJOR.MINOR.PATCH
```

During `0.x`, breaking changes may happen, but they must be documented in `CHANGELOG.md` and GitHub release notes.

## Release Checklist

1. Confirm the working tree only contains intended changes.

   ```bash
   git status --short
   ```

2. Run the full validation suite.

   ```bash
   npm test
   npm run lint
   npm run typecheck
   npm run build
   npm run test:e2e
   ```

3. Review generated or ignored files.

   ```bash
   git diff --check
   git status --short --ignored
   ```

4. Update `CHANGELOG.md`.

   Move relevant entries from `[Unreleased]` into the release version section.

5. Update package versions.

   ```bash
   npm version patch --workspaces=false --no-git-tag-version
   ```

   Use `minor` or `major` when appropriate.

6. Commit the release.

   ```bash
   git add package.json package-lock.json CHANGELOG.md
   git commit -m "Release vX.Y.Z"
   ```

7. Tag the release.

   ```bash
   git tag vX.Y.Z
   git push origin main --tags
   ```

8. Create a GitHub release.

   Include:

   - Summary.
   - New features.
   - Fixes.
   - Breaking changes.
   - Upgrade notes.
   - Migration notes for Docker, Compose, Caddy, and SQLite if needed.

## Release Notes Template

```md
## NaviProxy vX.Y.Z

### Highlights

- 

### Added

- 

### Changed

- 

### Fixed

- 

### Breaking Changes

- None.

### Upgrade Notes

1. Back up `data/naviproxy.sqlite`.
2. Pull the latest code.
3. Run `npm ci`.
4. Run `npm run build`.
5. Restart NaviProxy.
```

## Pre-release Builds

Use pre-release identifiers for unstable builds:

```txt
v0.2.0-alpha.1
v0.2.0-beta.1
v0.2.0-rc.1
```
