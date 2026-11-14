# ADR-0564: Prepare the release inside the feature pull request

Status: `accepted`
Decision date: 2026-11-14
Amends: [ADR-0221](../../release/packaging/0221-reviewed-cli-release-preparation.md) (the release pull request becomes the fallback), [ADR-0496](0496-share-exact-ci-builds-and-separate-release-generation-from-verification.md) (one verification covers a prepared feature pull request), [ADR-0522](0522-reuse-ci-verification-for-identical-content.md) (the daily audit reuses nothing)

## Context

Releasing v0.23.6 on 2026-11-14 took these measured stages after the feature pull request was opened:

| Stage                                   | Duration |
| --------------------------------------- | -------- |
| Feature pull request CI                 | 20.5 min |
| Main CI after merge, reused             | 1:10     |
| Release preparation                     | 3:25     |
| Release pull request candidate CI       | 14:05    |
| Manual merge of the release PR          | variable |
| Main CI after the release merge, reused | 1:16     |
| Tag                                     | 0:38     |
| Release matrix                          | 13:39    |

The candidate CI reused tests but rebuilt and reran quality (3:47), native artifacts (0:17), the build with manifest and SBOM (6:04), and distribution checks (3:30). That run verified the same source again with new release metadata. The separate release pull request also needed a second merge and a second main run.

The completion checker already accepts a prepared release against a pull request base. It rebuilds intent from the commits that added it, so a pull request that adds intent in one commit and consumes it in a later commit reaches `release_prepared`. With no pending `.changes/*.yaml` on main, release preparation goes straight to the tag check, and the tag still requires full CI on the exact main commit.

A second gap appeared. A clock-dependent test failed from 2026-11-08, and the daily audit reused passing test results for six days because the content had not changed.

## Decision

### Prepared feature pull request

The default release path prepares the release inside the feature pull request before merge. Then one full CI run covers the exact bytes that the tag later names.

`.github/workflows/release-pull-request.yml` (`CLI release in pull request`) performs the preparation. Two explicit triggers start it:

- Adding the `release` label to a same-repository pull request.
- `workflow_dispatch` with the `pull_request` input set to the pull request number.

The workflow resolves the pull request through the GitHub API. The pull request must be open, target `main`, come from this repository, and have a head branch other than `main` or `lervo/release-cli`. Fork pull requests never qualify, and their `pull_request` token cannot write anyway. The job runs on `macos-latest`, like the fallback preparation, so `pnpm build` produces the darwin native files that CI's restored `native-runtime` artifact contains. The manifest and SBOM therefore match CI byte for byte.

The workflow checks out two revisions. Its own revision goes to `tooling/` without credentials, and the observed pull request head goes to `pr/` with push credentials. `scripts/release/lib/reconcile-release-pull-request.sh` runs from `tooling/` and receives `pr/` as an explicit argument. A pull request branched before an operation existed can therefore still be prepared. Every `pnpm` owner command runs inside `pr/`, so the prepared bytes come from the pull request's own build, release, manifest, and SBOM owners. Running that build with a write token is the existing trust model for same-repository pull requests; forks stay excluded.

The script fetches current `main` and takes one of two paths:

1. If the head is this workflow's own preparation commit and its parent contains current `main`, the script revalidates the commit and does not regenerate it.
2. Otherwise the script removes its own preparation commit from the tip, if one is there. When the source does not contain current `main`, the script merges `main` into it as `lervo-release[bot]`. It then runs `pnpm release:prepare` plan and apply and commits `chore(cli): prepare release`.

Both paths run `release:manifest:check`, `release:sbom:check`, `release:completion:check --base <current main>`, the allowed-path check, and the clean-worktree check. These checks live in `scripts/release/lib/release-preparation-commit.sh`, which the fallback candidate script shares. Before pushing, the script confirms that the pull request is still open at the observed head. It pushes with `--force-with-lease` bound to that head. The push only adds the bot commit, or replaces the bot's own tip commit.

GitHub does not start `pull_request` workflows for a push made with the workflow token. The script therefore dispatches Code quality for the prepared commit with `expected_sha` and `base_sha` set to current `main`, the same way the fallback dispatches candidate CI. That run is a `workflow_dispatch`, so it runs every component, distribution checks included. It reuses tests from the unprepared head when they already passed, because the test digest ignores release metadata. After merge, main's tree equals the prepared head's tree, and main reuses the build, tests, and distribution checks by exact tree.

GitHub does not evaluate a dispatched run as a pull request check. The `dispatched-status` job in Code quality therefore posts the aggregate result as the commit status `CI verification (lervo-ci-v1)` on `expected_sha`, with the run as its target URL. The job runs only for `workflow_dispatch` runs that name an `expected_sha`. It holds only `statuses: write`. A successful `verification` job posts `success`, and any other result posts `failure`. The status makes the result visible on the pull request; it grants no release authority.

### Distribution on pull requests without pending intent

A full-coverage `pull_request` run with no pending `.changes/*.yaml` now also runs distribution checks. Main pushes without pending intent already required them, so main could not reuse a pull request's build until now. Distribution runs beside the test shards and does not lengthen the critical path. A pull request with pending intent still skips distribution, because its preparation run verifies distribution for the prepared bytes.

### Merge freshness

Main reuses pull request verification only when the merged tree equals the pull request head tree. `wait-release.sh pr <number>` waits for the newest non-skipped preparation run for that pull request. A failed preparation run is reported as a failure. The script then compares the head with its base branch. If the head does not contain the current base, it exits with code 3 (`stale`) and tells the caller to run `gh pr update-branch`, or to rerun preparation for a prepared pull request. Rerunning preparation merges `main` and prepares again. Freshness and verification judge one observed head. If the head moves during the checks, the script judges the new head on the next round. On success it prints that head, and the merge is bound to it with `gh pr merge --match-head-commit`.

For a fresh head, the newest Code quality `workflow_dispatch` run for that exact head SHA decides. It passes only when the run completed with `success` and its `CI verification (lervo-ci-v1)` job succeeded. Runs for older SHAs never count. A head that is this workflow's preparation commit waits until that dispatch exists. Any other head without a dispatch uses `gh pr checks`. The script needs only `gh` and its built-in `--jq`, so it behaves the same on every host.

### Fallback release pull request

ADR-0221's `lervo/release-cli` pull request stays as the fallback for intent that reaches `main` unprepared. External contributions and intent merged without the label take this path. `wait-release.sh release-pr` continues to serve it.

### Daily audit

On `schedule` events, `planCiReuse` reuses nothing. Test shards consume the build from their own run, so a run that executes tests must also build. Quality reuse is tied to build reuse. The audit therefore executes every component on every day.

## States, failures, and privacy

The preparation step writes `disposition` to its step output:

- `prepared`: one new preparation commit was pushed and its Code quality dispatch was requested.
- `current`: the head already carried a preparation commit on current `main`. The step revalidated it and requested a dispatch only when no successful or active one exists.

Every failure leaves the pull request branch unchanged and creates no tag:

| Code                                  | Meaning                                                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `release_pull_request_invalid`        | The dispatch input is not a pull request number.                                                                                                                          |
| `release_pull_request_ineligible`     | The pull request is closed, targets another branch, comes from a fork, or uses `main` or `lervo/release-cli` as its head.                                                 |
| `release_pull_request_superseded`     | The head moved or the pull request closed after observation.                                                                                                              |
| `release_pull_request_merge_conflict` | Current `main` does not merge cleanly. The author resolves the conflict and triggers preparation again.                                                                   |
| `release_pull_request_push_rejected`  | The lease or GitHub rejected the push. One example is a merge that changes workflow files, which the workflow token cannot push. The author merges `main` and retriggers. |
| `release_plan_invalid`                | Preparation printed no exact plan ID.                                                                                                                                     |

When the source has no pending intent, preparation stops with `No pending @lervo/cli release intent exists.` This also covers a preparation commit buried under later commits. To recover, the author drops or reverts that commit and triggers preparation again.

`wait-release.sh` exit code 3 (`stale`) means the head does not contain the current base. No check result is reported as success in that state.

Logs and outputs carry only the pull request number, branch name, commit IDs, the plan ID, versions, and failure codes. They never contain intent bodies, changed-file contents, or credentials. This decision adds no Lervo runtime event and no persistent state. The Git commit, the dispatched run, and the existing CI receipts are the record.

### Two pull requests on the same version line

Two pull requests prepared against the same `main` both bump to the same next version. After the first merges, the second fails in one of three places, and no tag is created:

- Git reports a conflict on `.changes/current-release.md`, the manifest, or the SBOM.
- `wait-release.sh pr` reports `stale`.
- If the second pull request still merged, `release:completion:check` on main reports `prepared_release_version_mismatch`. Main CI then fails, and release admission refuses the tag.

The recovery is to rerun preparation on the second pull request, which merges `main` and bumps from the new version.

## Consequences

The projected path is: preparation about 3.5 min, prepared-head CI 20.5 min, merge, main reuse about 1.2 min, tag 0.6 min, matrix 13.7 min. That totals about 40 min, against about 55 min plus a manual merge before. This decision removes the release-preparation-to-candidate round trip of about 19 min, the second merge, and the second main run. Hosted savings need observation after rollout.

Every full-coverage pull request without intent now spends distribution runner minutes, and main spends fewer because it reuses them. The daily audit costs a full run again, about 57 billed minutes instead of about 10. In exchange, it can no longer hide a result that changes with time.

The preparation workflow keeps repository, dispatch, and read authority for one same-repository branch. It has no npm authority, and no tag authority beyond what main already had. Code quality gains `statuses: write` only in its `dispatched-status` job. Rollback deletes the workflow and restores the previous distribution and reuse rules. The fallback release pull request keeps working throughout.

## Verification

`scripts/release/test/release-pull-request-workflow.test.mjs` runs the preparation script against a real Git remote. It checks the pushed bot commit and its paths, the exact dispatch, replay without regeneration, re-preparation after `main` moves, and no writes for a closed, moved, or ineligible pull request. `release-completion-check.test.mjs` covers separate intent and preparation commits against the pull request base and after a merge commit. It also checks that a squashed add-and-consume commit is blocked and that the second same-line pull request fails. It also prepares a head that predates the `pull-request` operation through this revision's tooling. `deploy-release-wait.test.mjs` checks that a prepared head passes only on its own successful dispatch with a successful aggregate job, waits without one, and reports stale heads and failed preparation. `code-quality-workflow.test.mjs` runs the distribution planning step for each event and the commit-status step for each verification result. `ci-content-reuse.test.mjs` checks that a scheduled run reuses nothing.
