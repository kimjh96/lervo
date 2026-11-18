# ADR-0588: Generate release metadata for pull requests before the release tag

Status: `accepted`
Decision date: 2026-11-18
Amends: [ADR-0572](0572-commit-cli-release-metadata-only-when-a-release-is-prepared.md) (an unprepared pull request is `generated` even while the CLI version is untagged)

## Context

ADR-0572 made every run `exact` while the tree's CLI version has no `v<version>` tag. After a release pull request merges, `main` carries the prepared version, and release preparation tags it only after `main`'s Code quality run succeeds. During those minutes, every pull request run was `exact` too. A pull request that changes bundled code builds other bytes than `main`'s committed manifest, so its `Release manifest and SBOM` job failed with `release_artifact_mismatch`. This happened three times on 2026-11-17 and 2026-11-18, including pull requests 271 and 279. A rerun after the tag existed passed.

The `exact` rule protects trees that a tag can name. A tag names a `main` revision admitted by a successful `push` or `workflow_dispatch` run (`ci-release-admission.mjs`). It never names a `pull_request` merge commit.

## Decision

`planReleaseMetadataVerification` in `scripts/quality/lib/ci-release-metadata.mjs` receives the pull request base, head, and head branch for a `pull_request` run. When the CLI version is untagged, the run is `generated` only if all of these hold:

- the changed paths are known and include neither metadata file;
- the base revision's `apps/cli/package.json` has the same valid version as the merged tree;
- the head branch is not `lervo/release-cli`;
- the head commit is not the release preparation commit (author `lervo-release[bot]`, subject `chore(cli): prepare release`).

Any unknown base, head, version, or commit keeps `exact`. All other rules of ADR-0572 are unchanged. `main`'s `push` run, dispatched runs, prepared heads, and edits to the metadata files stay `exact` while the version is untagged. Tag admission still requires the `Release metadata mode: exact` step.

### Merging before the tag

`main` still runs `exact` until its tag exists. A pull request that passed in `generated` mode during the window would fail `main` if it merged before the tag. Preparation would then find `release_main_superseded` for the release merge and a failed run for the new head, so the tag would wait for a metadata commit. To prevent this, `wait-release.sh pr` holds a passed unprepared head until `main`'s CLI version has its `v<version>` tag. It reads the version from the base branch through the contents API and the tag through `git ls-remote`. A prepared head carries its own release and never waits. A merge from the GitHub interface skips this hold, as it already skips the freshness check.

### Reporting unavailable GitHub queries

On 2026-11-18, `wait-release.sh release-pr` timed out after about 90 minutes, although the candidate runs had passed 17 minutes after it started. Its `gh` calls discarded stderr, and a failed summary defaulted to `0 0 0`, so the script read an API failure as "no runs yet".

`wait-release.sh` now runs every `gh` query through `gh_query`. A failed query records `gh_unavailable: <first stderr line>`, and a failed `git ls-remote` other than exit 2 records `git_unavailable: ...`. A round with a failed query concludes nothing. From the second failed round in a row, the script prints the failure to stderr. It doubles the pause after each failed round, up to eight poll intervals. A timeout message ends with `; last query failure: <failure>`. `gh pr checks` keeps its rule that printed output decides, and its `no checks reported` answer still counts as empty. When the jobs of a cancelled matrix run cannot be read, the tag stage waits instead of failing. Exit codes are unchanged.

## Failures and privacy

No new state or failure code is added to CI. `gh_unavailable` and `git_unavailable` are status text of a local wait script. They carry the first stderr line of `gh` or `git`, which names the host or HTTP status and no credentials.

## Consequences

Ordinary pull requests no longer fail between a release merge and its tag. Merging them through `wait-release.sh pr` waits up to the few minutes that the tag takes. A wait that loses GitHub access reports why and retries more slowly, so a timeout no longer looks like missing runs.

## Verification

`ci-verification-plan.test.mjs` covers an unprepared pull request before and after the tag, `main`'s push and dispatched runs, a version change, the fallback branch, a release preparation head commit, a metadata edit, and an unknown head or base. `deploy-release-wait.test.mjs` uses a fake `gh` that fails three times and then succeeds in the `pr`, `release-pr`, and `tag` stages. It also checks the timeout message, empty answers, an unreachable origin, an unreadable cancelled matrix, and the hold for main's release tag. GitHub CI runs these tests.
