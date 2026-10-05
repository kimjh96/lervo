# Code quality and commit CI execution

This reference describes the supplied `.github/workflows/code-quality.yml` and `.github/workflows/commit-convention.yml`. Read with the [code convention](code-convention.md), [commit convention](commit-convention.md), and [CLI version and release management](../distribution/cli-version-management.md).

## Shared workflow controls

Both workflows run on pull requests and pushes to `main`, grant `contents: read`, and run one job on `ubuntu-latest` with a ten-minute timeout. Concurrency groups include workflow and ref, prefixed by `code-quality-` and `commit-convention-`, respectively. A replacement run cancels an in-progress run in its group.

Both check out full history (`fetch-depth: 0`) and disable persisted credentials. Shared action pins:

- `actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd` (commented v6.0.2).
- `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` (commented v7.0.0).
- `pnpm/action-setup@d15e628ca66d93ee5f352c71671a7bc6a97af5c9` (commented v6.0.8).

Node is pinned to 22.13.0, package-manager caching is disabled, and dependencies install with `pnpm install --frozen-lockfile`. Neither YAML specifies a pnpm version; the setup action's version is not the package manager's version.

## Quality and release completion

The `quality` job (`ESLint and Prettier`) runs `pnpm quality:check`, then `pnpm typecheck`, then `pnpm architecture:check`. Typecheck resolves workspace packages from source through `tsconfig.json` path aliases and needs no prior build. Subsequent event-specific release completion steps run:

- Pull requests: `pnpm release:completion:check --base "${{ github.event.pull_request.base.sha }}"`.
- Pushes: `pnpm release:completion:check --base "${{ github.event.before }}"`.

Bases are explicitly event-bound. The workflow declares neither a fallback base nor continue-on-error behavior. The YAML establishes invocation and sequence, not successful completion or the checker's internal handling of unavailable Git objects.

## Node API baseline

Root `engines.node` declares the oldest supported Node release; every repository workflow runs that release. The `@types/node` development dependency uses a tilde range on the same major and minor version, allowing typecheck to reject APIs absent from the minimum's type definitions. Newer definitions can accept APIs that fail at runtime on the minimum: this mismatch once allowed code reading `DatabaseSync.isOpen`, absent in Node 22.13, to pass typecheck and fail release preparation.

Code requiring a newer Node API must raise `engines.node`, workflow Node versions, and the `@types/node` range together. Raising the minimum drops support for existing installations and requires reviewed `minor` or `major` release intent under [CLI version and release management](../distribution/cli-version-management.md). `scripts/quality/test/code-quality-workflow.test.mjs` verifies alignment of all three values.

## Commit ranges and fallback

The `commitlint` job (`Conventional Commits`) validates pull requests using `github.event.pull_request.base.sha` and `github.event.pull_request.head.sha`, passed through `BASE_SHA` and `HEAD_SHA`. It runs `pnpm commit:lint --from "$BASE_SHA" --to "$HEAD_SHA" --verbose`.

For pushes, `BASE_SHA` is `github.event.before` and `HEAD_SHA` is `github.sha`. The workflow checks whether the base resolves as a commit with `git cat-file -e "${BASE_SHA}^{commit}"`. If it resolves, the same range command runs; otherwise, it runs `pnpm commit:lint --last --verbose`.

This fallback qualifies the commit convention's claim that CI validates every commit pushed to `main`: an unresolvable base limits the check to the last commit. Full-history checkout does not remove the fallback. A successful fallback run must not be reported as proof that all commits in the push were validated.

## Evidence boundary

These files establish configured checks, inputs, permissions, and cancellation behavior. They do not establish that a run occurred, every step executed, or quality, release completion, or commit validation passed. Historical lifecycle failure identifiers alone neither establish earlier workflow contents nor resolve missing execution evidence.
