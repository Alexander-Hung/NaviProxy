# Version Control

The Containers uses a version-branch workflow. The goal is to keep `main` stable, keep day-to-day work in `develop`, and only create release branches for major/minor version lines.

## Branches

- `main`: stable release branch. Every commit on `main` should be releasable.
- `develop`: the only normal development branch. New work lands here directly through small, reviewed commits.
- `release/vX`: release hardening branch for a major version line, for example `release/v0` or `release/v1`.
- `hotfix/vX.Y.Z`: urgent production fix branch created from `main`.

## Tags

Every public release must have a git tag:

```bash
git tag v0.2.0
git push origin main --tags
```

Tags should point to commits on `main`.

## Normal Development

```bash
git checkout develop
git pull
```

Make small commits directly on `develop`. Before pushing or opening a release:

```bash
npm test
npm run lint
npm run typecheck
npm run build
git diff --check
```

## Release Flow

```bash
git checkout develop
git checkout -B release/v0
npm test
npm run lint
npm run typecheck
npm run build
git checkout main
git merge --no-ff release/v0
git tag v0.2.0
git checkout develop
git merge --no-ff main
```

Push after the release is verified:

```bash
git push origin main develop --tags
```

## Hotfix Flow

```bash
git checkout main
git checkout -b hotfix/v0.2.1
```

After the fix:

```bash
npm test
npm run lint
npm run typecheck
npm run build
git checkout main
git merge --no-ff hotfix/v0.2.1
git tag v0.2.1
git checkout develop
git merge --no-ff main
```

## Rules

- Do not commit directly to `main` except release merges or emergency fixes.
- Do not create `feature/*` branches for normal work.
- Keep development commits small and easy to review on `develop`.
- Keep release branches aligned to version lines, not individual features.
- Keep public docs and commit messages in English.
- Do not commit ignored local docs, SQLite databases, environment files, build output, or node_modules.
- Update `CHANGELOG.md` before tagging a release.
- Run the validation suite before merging to `main`.
