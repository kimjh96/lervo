# Commit-convention workflow verification

`.github/workflows/commit-convention.yml` validates Conventional Commits on pull requests and pushes to `main`. The [repository commit convention](../foundation/commit-convention.md) owns commit policy; this reference describes workflow execution and evidence boundaries.

## Validation ranges

For pull requests, the workflow passes `github.event.pull_request.base.sha` and `github.event.pull_request.head.sha` to `pnpm commit:lint --from "$BASE_SHA" --to "$HEAD_SHA" --verbose`.

For main pushes, it uses `github.event.before` and `github.sha`, first checking whether the base resolves to a commit with `git cat-file -e "${BASE_SHA}^{commit}"`. If available, it validates that range; otherwise, it runs `pnpm commit:lint --last --verbose`. This fallback checks only the last commit and does not prove validation of every commit in the push.

## Execution contract

The job runs on Ubuntu with a ten-minute timeout and read-only contents permission. Checkout requests full history and disables persisted credentials. Actions are pinned to full commit SHAs. Node is fixed at 22.13.0 with package-manager caching disabled. pnpm setup precedes frozen-lockfile installation; the YAML does not specify the pnpm version directly.

Concurrency groups by workflow and ref and cancels an in-progress run when replaced. The workflow defines no artifact upload or repository mutation step.

## Evidence boundaries

Configuration establishes intended checks, not successful execution. Passing commit lint does not establish reviewed release intent, release completion, or publication authority. Those remain separate checks described in [CLI version and release management](cli-version-management.md).
