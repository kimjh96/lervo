# ADR-0592: Leave pull requests with release intent to the preparation run

Status: `accepted`
Decision date: 2026-11-19
Amends: [ADR-0564](../../operations/services/0564-prepare-the-release-inside-the-feature-pull-request.md) (a pull request with pending release intent no longer runs full tests on its own `pull_request` events)

## Context

The repository is private, and the owner ruled on 2026-11-19 that GitHub Actions spend is too high.

From 2026-11-18 20:00 to 2026-11-19 07:00 UTC, Code quality used 858 Linux job-minutes. Its runs split as follows:

| Runs                                        | Minutes | What they were                                           |
| ------------------------------------------- | ------- | -------------------------------------------------------- |
| 6 dispatched for prepared heads, successful | 338     | The verification that admits a merge                     |
| 5 on `pull_request`, successful             | 272     | Full tests of heads that preparation then verified again |
| 8 superseded and cancelled                  | 177     | Runs replaced by a later push                            |

Every pull request that carries release intent is prepared before it merges (ADR-0564). Preparation adds one commit and dispatches Code quality in full for that exact commit, and only that run decides the merge (`wait-release.sh pr`). The full `pull_request` run on the unprepared head therefore verifies bytes that never merge, and the preparation run verifies the same code again minutes later.

## Decision

- **Only an intent the pull request adds counts.** On a `pull_request` event, the CI plan selects coverage `release_pending` (reason `release_preparation_verifies`) when the checked-out merge commit adds a pending intent (`.changes/relint_<24 hex>.yaml`) relative to its first parent, the current base branch. An intent already waiting on the base belongs to the base and changes nothing for other pull requests.
- **What runs:**
  - The plan and quality jobs run, including the type check: lint, format, types, structure, docs and release completion.
  - The native build, release artifacts, tests, the test reuse shadow and distribution do not run.
- **The aggregate accepts it.** `CI verification (lervo-ci-v1)` accepts `release_pending` only with build, tests and distribution skipped, as it does `documentation_only`.
- **An unprepared head is never admitted on these checks.** `wait-release.sh pr` keeps waiting on an unprepared head that still carries intent and names the preparation command (`gh pr edit <n> --add-label release`). The repository's plan cannot enforce branch protection, so the deploy skill's merge gate is where this is enforced.
- **Unchanged:**
  - every `push`, dispatch and scheduled run;
  - every pull request that adds no intent;
  - the preparation's dispatched run, which still runs everything for the prepared commit;
  - the release admission, which reads only runs on `main`.

## Consequences

- **Saving:** about one full test run (about 55 Linux job-minutes) per push to a pull request with intent.
- **Later failures:** a test failure in such a pull request now surfaces at preparation, not on the earlier push. Fixes still go below the preparation commit, so finding them later costs one preparation, not a release.
- **An unprepared merge** of such a head is still verified, because the `push` to `main` runs in full.
- **Rollback:** revert this change; pull requests with intent then run full tests on every push again.

## Verification

`scripts/quality/test/ci-verification-plan.test.mjs` builds real merge commits and checks these cases:

- a code change selects `full`;
- a pull request that adds an intent selects `release_pending`;
- a later pull request on a base that already holds an intent selects `full`;
- `push` and dispatch stay `full`;
- the aggregate passes `release_pending` only with skipped build, tests and distribution.

`scripts/release/test/deploy-release-wait.test.mjs` checks that an unprepared head that carries intent is never admitted.
