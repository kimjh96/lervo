# CI quality and commit gates

`.github/workflows/code-quality.yml` and `.github/workflows/commit-convention.yml` configure separate gates for pull requests and pushes to `main`. This document describes configuration, not evidence of passed runs.

## Shared execution configuration

Each workflow grants `contents: read`, runs one job on `ubuntu-latest`, and sets a ten-minute timeout. Concurrency groups include the workflow and ref, prefixed respectively with `code-quality-` and `commit-convention-`. Replacement runs cancel in-progress runs in the same group.

Both workflows check out full history with `fetch-depth: 0`, disable persisted checkout credentials, use Node 22.13.0 with package-manager caching disabled, set up pnpm, and run `pnpm install --frozen-lockfile`. Neither YAML specifies a pnpm version.

Both pin setup actions to these exact commits:

- `actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd` (commented v6.0.2).
- `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` (commented v7.0.0).
- `pnpm/action-setup@d15e628ca66d93ee5f352c71671a7bc6a97af5c9` (commented v6.0.8).

## Quality and release completion

The `quality` job, named `ESLint and Prettier`, first runs `pnpm quality:check`, then inspects release completion by event:

- Pull requests: `pnpm release:completion:check --base "${{ github.event.pull_request.base.sha }}"`.
- Pushes: `pnpm release:completion:check --base "${{ github.event.before }}"`.

The YAML defines no alternate base or fallback for either command. Release-completion checks are separate from commit-message validation. Their governing contracts are the [code convention](code-convention.md) and [CLI version and release management](../distribution/cli-version-management.md).

## Commit validation ranges

The `commitlint` job, named `Conventional Commits`, selects its validation range by event.

For pull requests, `BASE_SHA` comes from `github.event.pull_request.base.sha` and `HEAD_SHA` from `github.event.pull_request.head.sha`. The job runs `pnpm commit:lint --from "$BASE_SHA" --to "$HEAD_SHA" --verbose`.

For pushes, `BASE_SHA` comes from `github.event.before` and `HEAD_SHA` from `github.sha`. The job tests `git cat-file -e "${BASE_SHA}^{commit}"`. On success, it uses the same explicit range command. Otherwise, it runs `pnpm commit:lint --last --verbose`, validating only the last commit, not establishing validation of the complete pushed range.

The workflow delegates message rules to `commit:lint`; its YAML alone does not define accepted types or scopes. See the [commit convention](commit-convention.md).

## Evidence boundary

Workflow configuration establishes intended triggers, commands, and permissions. It does not establish completed checks, branch-protection requirements, release readiness, or publication. Historical lifecycle failure identifiers do not establish previous workflow content or resolve missing run evidence.
