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

- **Quality checks only.** On a `pull_request` event whose checked-out tree contains a pending intent (`.changes/relint_<24 hex>.yaml`), the CI plan selects coverage `release_pending` (reason `release_preparation_verifies`).
  - The plan and quality jobs run as before: lint, format, structure, docs and release completion.
  - The native build, release artifacts, tests, the test reuse shadow and distribution do not run.
- **The aggregate accepts it.** `CI verification (lervo-ci-v1)` accepts `release_pending` with skipped build, tests and distribution, exactly like `documentation_only`.
- **Unchanged:**
  - every `push`, dispatch and scheduled run;
  - every pull request without pending intent;
  - the preparation's dispatched run, which still runs everything for the prepared commit;
  - the release admission, which only reads runs on `main`.

## Consequences

- **Saving:** about one full test run (about 55 Linux job-minutes) per push to a pull request with intent.
- **Later failures:** a test failure in such a pull request now surfaces at preparation, not on the earlier push. Fixes still go below the preparation commit, so finding them later costs one preparation, not a release.
- **An unprepared merge** of such a head is still verified, because the `push` to `main` runs in full.
- **Rollback:** revert this change; pull requests with intent then run full tests on every push again.

## Verification

`scripts/quality/test/ci-verification-plan.test.mjs` checks four cases:

- a code change selects `full`;
- adding a pending intent selects `release_pending` for `pull_request`;
- `push` and dispatch stay `full`;
- the aggregate passes `release_pending` only with skipped build, tests and distribution.
