# Code quality and commit CI execution

This reference describes the supplied `.github/workflows/code-quality.yml` and `.github/workflows/commit-convention.yml`. Read it with the [code convention](code-convention.md), [commit convention](commit-convention.md), and [CLI version and release management](../distribution/cli-version-management.md).

## Shared workflow controls

Both workflows run on pull requests and pushes to `main`. Each grants `contents: read`, runs one job on `ubuntu-latest`, and sets a ten-minute timeout. Concurrency groups include the workflow and ref, prefixed respectively by `code-quality-` and `commit-convention-`. A replacement run cancels an in-progress run in its group.

Both check out full history with `fetch-depth: 0` and disable persisted credentials. Shared setup uses these action pins:

- `actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd` (commented v6.0.2).
- `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` (commented v7.0.0).
- `pnpm/action-setup@d15e628ca66d93ee5f352c71671a7bc6a97af5c9` (commented v6.0.8).

Node is pinned to 22.13.0, package-manager caching is disabled, and dependencies are installed with `pnpm install --frozen-lockfile`. Neither YAML specifies a pnpm version; the setup action's version is not the package manager's version.

## Quality and release completion

The `quality` job, displayed as `ESLint and Prettier`, first runs `pnpm quality:check`. Subsequent event-specific steps invoke release completion:

- Pull requests: `pnpm release:completion:check --base "${{ github.event.pull_request.base.sha }}"`.
- Pushes: `pnpm release:completion:check --base "${{ github.event.before }}"`.

These bases are explicitly event-bound. The workflow declares no fallback base or continue-on-error behavior. The YAML establishes invocation and sequencing, not successful completion or the checker's internal handling of unavailable Git objects.

## Commit ranges and fallback

The `commitlint` job, displayed as `Conventional Commits`, validates pull requests using `github.event.pull_request.base.sha` and `github.event.pull_request.head.sha`, passed through `BASE_SHA` and `HEAD_SHA`. It runs `pnpm commit:lint --from "$BASE_SHA" --to "$HEAD_SHA" --verbose`.

For pushes, `BASE_SHA` is `github.event.before` and `HEAD_SHA` is `github.sha`. The workflow tests whether the base resolves as a commit with `git cat-file -e "${BASE_SHA}^{commit}"`. If it does, the same range command runs; otherwise, it runs `pnpm commit:lint --last --verbose`.

This fallback qualifies the commit convention's statement that CI validates every commit pushed to `main`: an unresolvable base limits the configured check to the last commit. Full-history checkout does not remove this fallback. A successful fallback run must not be reported as proof that all commits in the push were validated.

## Evidence boundary

These files establish configured checks, inputs, permissions, and cancellation behavior. They do not establish that a run occurred, every step executed, or quality, release completion, or commit validation passed. Historical lifecycle failure identifiers alone neither establish earlier workflow contents nor resolve missing execution evidence.
