# Version Control

The Containers uses a lightweight release-branch workflow. The goal is to keep `main` stable while still allowing fast solo development.

## Branches

- `main`: stable release branch. Every commit on `main` should be releasable.
- `develop`: integration branch for completed work before a release.
- `feature/<short-name>`: focused feature or fix branches created from `develop`.
- `release/vX.Y`: release hardening branch for a minor release.
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
git checkout -b feature/deployment-drift-repair
```

After the feature is complete:

```bash
npm test
npm run lint
npm run typecheck
npm run build
git diff --check
```

Merge back through a pull request or a reviewed local merge:

```bash
git checkout develop
git merge --no-ff feature/deployment-drift-repair
```

## Release Flow

```bash
git checkout develop
git checkout -B release/v0.2
npm test
npm run lint
npm run typecheck
npm run build
git checkout main
git merge --no-ff release/v0.2
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
- Keep feature branches small and focused.
- Keep public docs and commit messages in English.
- Do not commit ignored local docs, SQLite databases, environment files, build output, or node_modules.
- Update `CHANGELOG.md` before tagging a release.
- Run the validation suite before merging to `main`.

