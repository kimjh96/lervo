# ADR-0496: Share exact CI builds and separate release generation from verification

Status: `accepted`
Decision date: 2026-10-08
Amends: [ADR-0470](0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md) (CI), [ADR-0221](../../release/packaging/0221-reviewed-cli-release-preparation.md) (release workflow)

## Context and authority

The owner approved the [CI redesign](../../../roadmap/operations/ci-cost-and-duration.md) after reviewing its scope and estimates. The sampled ordinary pipeline used five builds and a median 81.4 runner-minutes. Full release preparation had an 84.08-minute median, including another whole-repository test run. Installation usually took twelve seconds, so dependency caching was not the principal bottleneck.

Approval covers source implementation and local verification. Hosted rollout, observed savings, release tags, and npm publication retain their distinct evidence and authority boundaries.

## Decision

### Verification scope and aggregate result

Every ordinary PR and main push retains quality, commit, architecture, branding, natural-language, document-lifecycle, and base-bound release checks. Only a complete diff containing Markdown under `docs/`, outside test/fixture directories, qualifies for `documentation_only`. Packaged READMEs, JSON, sidecars, runtime assets, source, configuration, release metadata, and unknown inputs select `full`. Git diff disables rename detection so both sides of a move are evaluated. Missing ancestry or excessive changed paths selects full coverage; it does not bypass base-bound completion.

Explicit dispatch and the daily audit force full coverage. Full coverage includes minimum-Node typechecking, one build, manifest/SBOM verification, and four test shards with two workers each. A bounded duration profile changes shard placement only; each discovered file occurs exactly once, including new files. The test isolation contract remains unchanged.

The `CI verification (lervo-ci-v1)` job runs after all required results are available, even after failure. Its version-1 receipt names the contract `lervo-ci-v1`, exact revision, workflow-run ID, coverage, aggregate disposition, and job results. `passed` requires quality and every required job to succeed; `failed`, cancelled jobs, missing coverage, and unknown results block consequential release effects. Documentation-only success never claims a full test run.

Distribution smoke checks use the shared build on dispatch, daily audit, and full main pushes without pending release intent. They retain attestation, built CLI/Hub/Node, standalone distributions, packed-consumer, isolated-registry, and knowledge-lint checks. Code changes with pending intent receive full tests and metadata checks; the generated candidate then receives the full distribution suite.

### Exact build transfer

One Linux build producer uploads a tar archive and a version-1 receipt for three days. The receipt binds contract, source revision, platform, architecture, exact Node version, workflow/run identity and producer attempt, archive SHA-256, and allowed output directories. Consumers download from their own run and reject identity or digest mismatch, unknown directories, oversized input, traversal, links, and missing outputs before accepting restoration. A failed-consumer retry may reuse an earlier successful producer from the same run; different-run or future-attempt artifacts are rejected. A rerun producer replaces its same-run artifact. Restore validates destination parents and removes stale output files before extraction. Archive size is bounded at 512 MiB; the receipt at 64 KiB and 256 directories.

Upload only `apps/*/dist` and `packages/*/dist`. Retain executable modes. Do not upload dependency stores, Git configuration, user state, credentials, or databases. Cross-platform matrix jobs continue building on their own OS. A cache or receipt alone never establishes successful tests.

### Release generation and effects

Release preparation follows successful Code quality push runs on main, or an explicit main-only retry. Before effects, a GitHub observer validates the current remote main SHA and the exact successful same-repository run, workflow ID, main branch, allowed event, aggregate job, and latest job attempts. Stale, failed, fork-origin, incomplete, and unsupported observations stop the write.

The non-cancellable, serialized generation job retains exact plan/apply, frozen installation, generated owners, rollback, release completion, allowed changed paths, and clean-worktree checks. It removes duplicate `pnpm check`. A matching existing candidate is revalidated instead of regenerated. Branch updates use an exact observed predecessor lease, including the absent-ref case; they never reset an unrelated ref with an unconditional force operation.

Candidate PRs preserve every template section, report observed generation evidence, and leave full verification unchecked. Updates replace only a marked managed body block and preserve user-owned surrounding text; missing or ambiguous ownership blocks reconciliation. The workflow explicitly dispatches Code quality for the exact candidate and source base. A moved branch is rejected. Same-repository automated release-branch PR events delegate verification to that dispatch, preventing a second heavy route; fork PRs with the same branch name retain ordinary verification. Successful or active matching dispatches suppress duplicates; failed or cancelled dispatches remain retryable.

The old requirement to run whole-repository checks before creating the candidate is replaced by mandatory full verification of the generated candidate. Creation establishes a reviewable version proposal, not release readiness. After merge, tag creation independently requires the exact current main's full CI, all four shards, metadata, distribution checks, and aggregate success. Source, candidate, and merged-main success are not interchangeable. Existing exact tag replay and the three-platform handoff remain intact. No npm authority is added.

### Test time and module boundaries

Native-completion tests use an isolated test clock shared by the supervisor and managed CLI subprocess. It advances lease time without changing monotonic timers, production authority policy, or provider adapters. A child-process assertion proves both processes observed expiry. The protocol fixture owns provider simulation; the lifecycle test owns completion and recovery assertions.

CI classification, transfer, shard placement, and aggregate evidence belong to `scripts/quality`. Release admission and PR rendering belong to `scripts/release`. Workflow entrypoints translate events and invoke these owners. Receipts and timing profiles expose bounded repository identities, digests, counts, and durations, never credentials or user payload. No product runtime event or per-run tracked archive is introduced.

## Failure and verification

`ci_revision_mismatch` rejects stale dispatch. `ci_build_identity_mismatch`, `ci_build_digest_mismatch`, archive bounds/path/type failures, and missing outputs reject transfer. `release_main_superseded`, invalid CI identity/result, missing aggregate/full coverage, and unavailable exact CI reject Git effects. API failures propagate rather than grant authority.

Tests cover conservative classification, rename boundaries, unknown ancestry, stale dispatch, aggregate failure/cancellation, build roundtrip and modes, corruption and identity mismatch, deterministic shard coverage, exact GitHub admission, and honest PR evidence. Full-suite, source-quality, release, documentation, and hosted acceptance gates are recorded separately in the roadmap. Local success does not establish hosted savings or publication.

Rollback restores the prior full workflow graph. It never moves a tag or replays an uncertain external effect automatically.
