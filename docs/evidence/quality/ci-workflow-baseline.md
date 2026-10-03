# Code-quality and commit-convention CI baseline

This baseline records configured behavior in the supplied `.github/workflows/code-quality.yml` and `.github/workflows/commit-convention.yml`, not completed runs or successful validation.

## Shared execution controls

Both workflows:

- Run on pull requests and pushes to `main`.
- Grant `contents: read` and run one job on `ubuntu-latest` with a ten-minute timeout.
- Use concurrency groups containing the workflow and ref: `code-quality-${{ github.workflow }}-${{ github.ref }}` and `commit-convention-${{ github.workflow }}-${{ github.ref }}`, respectively. Both cancel an in-progress run when replaced.
- Check out full history with `fetch-depth: 0` and disable persisted checkout credentials.
- Pin these shared actions:
  - `actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd` (commented v6.0.2).
  - `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` (commented v7.0.0).
  - `pnpm/action-setup@d15e628ca66d93ee5f352c71671a7bc6a97af5c9` (commented v6.0.8).
- Fix Node at 22.13.0 with `package-manager-cache: false` and install dependencies using `pnpm install --frozen-lockfile`.

Neither YAML specifies a pnpm version; the setup action version does not establish the package-manager version.

## Code quality and release completion

The `Code quality` workflow's `quality` job, named `ESLint and Prettier`, runs `pnpm quality:check` after installation, followed by:

- Pull requests: `pnpm release:completion:check --base "${{ github.event.pull_request.base.sha }}"`.
- Pushes: `pnpm release:completion:check --base "${{ github.event.before }}"`.

The workflow supplies explicit Git bases instead of relying on local default base selection. It declares no fallback for an unavailable push base. The command implementation owns validation and failure diagnostics; the YAML alone does not prove their outcomes.

See [Code convention](../../foundation/code-convention.md) for quality policy and [CLI version and release management](../../distribution/cli-version-management.md) for release intent and completion requirements.

## Commit validation

The `Commit convention` workflow's `commitlint` job is named `Conventional Commits`.

For pull requests, it sets `BASE_SHA` to `github.event.pull_request.base.sha` and `HEAD_SHA` to `github.event.pull_request.head.sha`, then runs `pnpm commit:lint --from "$BASE_SHA" --to "$HEAD_SHA" --verbose`.

For pushes, it sets `BASE_SHA` to `github.event.before` and `HEAD_SHA` to `github.sha`, then tests whether the base resolves to a commit with `git cat-file -e "${BASE_SHA}^{commit}"`:

- On success, it validates the base-to-head range with the same command.
- Otherwise, it runs `pnpm commit:lint --last --verbose`, validating the last commit without establishing validation of the entire pushed range.

The YAML specifies invocation and range selection. Accepted commit syntax and internal linter rules remain owned by the repository commit convention and command configuration.

## Evidence limits

These files establish configured CI behavior only, not successful installation, completed checks, branch-protection requirements, or release readiness. Historical assessment-gap records contain no workflow execution evidence and do not date these behaviors.
