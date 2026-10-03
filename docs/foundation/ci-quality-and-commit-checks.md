# CI quality and commit checks

## Scope

This document describes the supplied `.github/workflows/code-quality.yml` and `.github/workflows/commit-convention.yml` configurations:

- [Quality and release completion](ci-quality-and-commit-checks/quality-and-release-completion.md): quality checks and event-specific release inspection.
- [Commit validation](ci-quality-and-commit-checks/commit-validation.md): commit ranges and push fallback.

The [code convention](code-convention.md) defines implementation quality requirements; [CLI version and release management](../distribution/cli-version-management.md) defines reviewed release completion.

## Shared configuration

Both workflows run on pull requests and pushes to `main`. Each grants `contents: read`, runs one job on `ubuntu-latest` with a ten-minute timeout, and groups concurrency by its own workflow and ref, cancelling an in-progress run when replaced.

Both check out full Git history with `fetch-depth: 0` and disable persisted checkout credentials. They use Node 22.13.0 with package-manager caching disabled, set up pnpm, and run `pnpm install --frozen-lockfile`. Neither YAML specifies a pnpm version.

Shared actions are pinned to:

- `actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd`
- `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020`
- `pnpm/action-setup@d15e628ca66d93ee5f352c71671a7bc6a97af5c9`

## Evidence boundaries

Workflow configuration establishes intended execution, not completed checks. The supplied sources contain no run results proving successful quality checks, release-completion checks, or commit validation. Commit validation does not replace reviewed release intent. Neither workflow stages or publishes an npm package.
