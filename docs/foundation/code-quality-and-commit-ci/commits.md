# Commit ranges and fallback

The `commitlint` job, displayed as `Conventional Commits`, validates pull requests using `github.event.pull_request.base.sha` and `github.event.pull_request.head.sha`, passed through `BASE_SHA` and `HEAD_SHA`. It runs `pnpm commit:lint --from "$BASE_SHA" --to "$HEAD_SHA" --verbose`.

For pushes, `BASE_SHA` is `github.event.before` and `HEAD_SHA` is `github.sha`. The workflow checks whether the base resolves as a commit with `git cat-file -e "${BASE_SHA}^{commit}"`. If it resolves, the same range command runs; otherwise, it runs `pnpm commit:lint --last --verbose`.

This fallback qualifies the [commit convention](../commit-convention.md)'s statement that CI validates every commit pushed to `main`: an unresolvable base limits the configured check to the last commit. Full-history checkout does not remove the fallback. A successful fallback run must not be reported as proof that all commits in the push were validated.
