# Commit convention

Status: `active`
As of: 2026-08-25

Lervo follows [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/). Every commit header uses:

```text
<type>[optional scope][optional !]: <description>
```

Use `feat` for features and `fix` for bug fixes. Other accepted types are `build`, `chore`, `ci`, `docs`, `perf`, `refactor`, `revert`, `style`, and `test`. Use a short, lowercase description and keep the full header within 100 characters. An optional body follows one blank line; Git-trailer-style footers follow another blank line.

## Package scopes

Scopes are optional. For a commit belonging to one workspace package, use its exact unscoped name:

```text
feat(cli): orchestrate repository upgrades
fix(node-runtime): preserve retryable offline health
refactor(repository-knowledge): share instruction route generation
```

For example, `@lervo/repository-knowledge` maps to `repository-knowledge`. Allowed scopes come from current `apps/*/package.json` and `packages/*/package.json` manifests; no separate list is maintained. Omit the scope for repository-wide changes. Split independently releasable changes instead of inventing a multi-package scope.

## Breaking changes

Put `!` immediately before the colon or add a `BREAKING CHANGE: <description>` footer. The footer token must be uppercase and describe the incompatible behavior.

```text
feat(execution-contract)!: require capability activation receipts

BREAKING CHANGE: managed provider adapters must return an activation receipt.
```

For changes in `@lervo/cli` or its packed private-package closure, the marker is evidence that CI reconciles with reviewed release intent. It requires a `major` `.changes/relint_*.yaml` record but does not create or modify that record. Before 1.0, reviewed `major` intent advances the minor version while retaining its breaking-change meaning. See [CLI version and release management](../distribution/cli-version-management.md).

## Verification

Check one message through stdin:

```bash
printf '%s\n' 'feat(cli): add repository upgrade planning' | pnpm commit:lint
```

CI validates every commit introduced by a pull request and every commit pushed to `main`. An invalid message fails the convention job without rewriting history. Validation uses `@commitlint/config-conventional` and the package-derived scope list.
