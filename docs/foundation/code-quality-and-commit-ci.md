# Code quality and commit CI execution

This reference describes the supplied `.github/workflows/code-quality.yml` and `.github/workflows/commit-convention.yml`. Read it with the [code convention](code-convention.md), [commit convention](commit-convention.md), and [CLI version and release management](../distribution/cli-version-management.md).

- [Quality, release completion, and Node baseline](code-quality-and-commit-ci/quality.md)
- [Commit ranges and fallback](code-quality-and-commit-ci/commits.md)

## Shared workflow controls

Both workflows run on pull requests and pushes to `main`. Each grants `contents: read`, runs one job on `ubuntu-latest`, and sets a ten-minute timeout. Concurrency groups include the workflow and ref, prefixed by `code-quality-` and `commit-convention-`, respectively. Replacement runs cancel in-progress runs in the same group.

Both check out full history with `fetch-depth: 0` and disable persisted credentials. Shared action pins are:

- `actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd` (commented v6.0.2).
- `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` (commented v7.0.0).
- `pnpm/action-setup@d15e628ca66d93ee5f352c71671a7bc6a97af5c9` (commented v6.0.8).

Node is pinned to 22.13.0, package-manager caching is disabled, and installation uses `pnpm install --frozen-lockfile`. Neither YAML specifies a pnpm version; the setup action's version is not the package manager's version.

## Evidence boundary

These files establish configured checks, inputs, permissions, and cancellation behavior. They do not prove that a run occurred, every step executed, or quality, release completion, or commit validation passed. Historical lifecycle failure identifiers alone neither establish earlier workflow contents nor resolve missing execution evidence.
