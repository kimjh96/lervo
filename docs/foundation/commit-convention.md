# Commit convention

Status: `active`
As of: 2026-08-25

Lervo follows [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/). Every commit header uses:

```text
<type>[optional scope][optional !]: <description>
```

Use `feat` for features and `fix` for bug fixes. Accepted types also include `build`, `chore`, `ci`, `docs`, `perf`, `refactor`, `revert`, `style`, and `test`. Use a short, lowercase description and keep the full header within 100 characters. Put an optional body after one blank line and Git-trailer-style footers after another blank line.

## Package scopes

Scope is optional. For a commit belonging to one workspace package, use its exact unscoped name:

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

## Verification

Check one message through stdin:

```bash
printf '%s\n' 'feat(cli): add repository upgrade planning' | pnpm commit:lint
```

CI validates every commit introduced by a pull request and every commit pushed to `main`. An invalid message fails the convention job without rewriting history. Validation uses `@commitlint/config-conventional` and the package-derived scope list.
