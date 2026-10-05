# Quality, release completion, and Node baseline

## Quality and release completion

The `quality` job, displayed as `ESLint and Prettier`, runs these commands in order:

1. `pnpm quality:check`
2. `pnpm typecheck`
3. `pnpm architecture:check`

Typecheck resolves workspace packages from source through `tsconfig.json` path aliases and needs no prior build. Subsequent event-specific steps invoke release completion:

- Pull requests: `pnpm release:completion:check --base "${{ github.event.pull_request.base.sha }}"`.
- Pushes: `pnpm release:completion:check --base "${{ github.event.before }}"`.

These bases are explicitly event-bound. The workflow declares no fallback base or continue-on-error behavior. The YAML establishes invocation and sequencing, not successful completion or the checker's handling of unavailable Git objects.

## Node API baseline

The root `engines.node` field declares the oldest supported Node release, which every repository workflow runs. The `@types/node` development dependency uses a tilde range on the same major and minor version, so typecheck rejects Node APIs absent from the minimum's type definitions.

Newer type definitions accept APIs that fail at runtime on the minimum. This mismatch once allowed code reading `DatabaseSync.isOpen`, which Node 22.13 lacks, to pass typecheck and fail release preparation.

Code requiring a newer Node API must raise `engines.node`, workflow Node versions, and the `@types/node` range together. Raising the minimum drops support for existing installations and requires reviewed `minor` or `major` release intent under [CLI version and release management](../../distribution/cli-version-management.md). `scripts/quality/test/code-quality-workflow.test.mjs` verifies that these three values stay aligned.
