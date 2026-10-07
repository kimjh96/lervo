# Workflow controls, quality, artifacts, and tests

This retained source description is unverified and subject to the [evidence correction](../code-quality-and-commit-ci.md). Claims beyond its supported baseline require the missing configuration or execution evidence; they are not operational guarantees.

## Shared workflow controls

The retained description states that `.github/workflows/code-quality.yml` and `.github/workflows/commit-convention.yml`:

- Run on pull requests and pushes to `main`, grant `contents: read`, and run their quality and commit jobs on `ubuntu-latest` with ten-minute timeouts.
- Use concurrency groups containing workflow and ref, prefixed by `code-quality-` and `commit-convention-`, respectively; replacement runs cancel in-progress runs in the same group.
- Check out full history (`fetch-depth: 0`) with persisted credentials disabled.
- Pin Node to 22.13.0, disable package-manager caching, and install dependencies with `pnpm install --frozen-lockfile`.

Shared action pins:

- `actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd` (commented v6.0.2).
- `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` (commented v7.0.0).
- `pnpm/action-setup@d15e628ca66d93ee5f352c71671a7bc6a97af5c9` (commented v6.0.8).

Neither YAML specifies a pnpm version; the setup action version is not the package-manager version. Code quality also runs the artifact and test jobs below.

## Quality and release completion

The retained description gives this sequence for `quality` (`ESLint and Prettier`): `pnpm quality:check`, `pnpm typecheck`, then `pnpm architecture:check`. Typecheck resolves workspace packages from source through `tsconfig.json` path aliases without a prior build.

Subsequent release-completion steps use event-bound bases:

- Pull requests: `pnpm release:completion:check --base "${{ github.event.pull_request.base.sha }}"`.
- Pushes: `pnpm release:completion:check --base "${{ github.event.before }}"`.

The described workflow declares neither a fallback base nor continue-on-error behavior. YAML would establish invocation and sequence, not successful completion or the checker's internal handling of unavailable Git objects.

## Release artifacts

Under [ADR-0470](../../decisions/operations/services/0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md), the retained description places `release-artifacts` (`Release manifest and SBOM`) on every pull request and push to `main`, using the shared pins, Node 22.13.0, and frozen install.

Its claimed timeout is 20 minutes. It runs `pnpm build`, then `pnpm release:manifest:check` and `pnpm release:sbom:check`. A stale `apps/cli/release-artifact-manifest.json` or `apps/cli/release-sbom.cdx.json` fails the pull request, not only the release branch. The packed-CLI matrix still runs only for `lervo/release-cli`, tags, and manual dispatch.

## Tests and user-state isolation

The retained description also places `test` (`Tests (shard n/4)`) on every pull request and push to `main`, using the shared pins, Node 22.13.0, and frozen install. It specifies four shards, a 45-minute timeout per shard, and no fail-fast. Each shard configures a Git identity for repository fixtures, runs `pnpm build`, then runs `pnpm test --maxWorkers=2 --testTimeout=30000 --shard=<n>/4`.

Two workers match the hosted runner's cores. As described in [ADR-0356](../../decisions/execution/verification/0356-bound-test-deadlines-for-busy-host-shards.md), the default deadline exceeds Vitest's 5-second default because CPU-bound tests taking 4 seconds on a developer machine exceeded that deadline on two-core runners. Per-test deadlines still take precedence; assertions are unchanged. The claimed first-run duration of 15 to 22 minutes per shard remains unverified.

The retained description says the Vitest setup file `scripts/quality/lib/test-user-state-isolation.mjs` points `LERVO_USER_STATE_DIRECTORY` to a per-process temporary directory, preventing any test from reading or changing a developer's host registry, continuity policy, host resident status, or user services. This isolation claim is not an observed execution result.
