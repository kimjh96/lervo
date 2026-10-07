# Commit ranges and fallback

This retained description of `.github/workflows/commit-convention.yml` is unverified and subject to the [evidence correction](../code-quality-and-commit-ci.md). The [commit convention](../commit-convention.md) requires validation of every introduced pull-request commit and every commit pushed to `main`; the claimed fallback does not currently qualify that canonical policy.

## Pull requests

The retained description says `commitlint` (`Conventional Commits`) passes `github.event.pull_request.base.sha` and `github.event.pull_request.head.sha` through `BASE_SHA` and `HEAD_SHA`, then runs `pnpm commit:lint --from "$BASE_SHA" --to "$HEAD_SHA" --verbose`.

## Pushes

For pushes, the described workflow sets `BASE_SHA` to `github.event.before` and `HEAD_SHA` to `github.sha`. It checks whether the base resolves as a commit with `git cat-file -e "${BASE_SHA}^{commit}"`:

- If it resolves, run `pnpm commit:lint --from "$BASE_SHA" --to "$HEAD_SHA" --verbose`.
- Otherwise, run `pnpm commit:lint --last --verbose`.

The retained source characterizes this fallback as a qualification of the convention's all-commits claim: an unresolvable base limits validation to the last commit, and full-history checkout does not remove the fallback. This workflow behavior remains unverified. A successful fallback run must not be reported as proof that all commits in the push were validated.
