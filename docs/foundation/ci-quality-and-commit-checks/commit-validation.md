# Commit validation

In `.github/workflows/commit-convention.yml`, the `commitlint` job selects the commit range by event.

## Pull requests

The job sets `BASE_SHA` to `github.event.pull_request.base.sha` and `HEAD_SHA` to `github.event.pull_request.head.sha`, then runs:

```bash
pnpm commit:lint --from "$BASE_SHA" --to "$HEAD_SHA" --verbose
```

The pull-request step declares no fallback.

## Pushes to `main`

The job sets `BASE_SHA` to `github.event.before` and `HEAD_SHA` to `github.sha`, then checks whether `git cat-file -e "${BASE_SHA}^{commit}"` succeeds. If so, it runs the same range command. Otherwise, it runs `pnpm commit:lint --last --verbose`.

The fallback validates only the last commit; it does not establish validation of the entire pushed range.

## Validation scope

The YAML invokes the repository's commit validator but does not define accepted types, scopes, or other message rules.

See [CI quality and commit checks](../ci-quality-and-commit-checks.md) for shared configuration and evidence boundaries.
