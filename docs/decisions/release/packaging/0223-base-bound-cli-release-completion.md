# ADR-0223: Base-bound CLI release completion

Status: accepted
Date: 2026-08-26

## Context

ADR-0221 requires reviewed intent for CLI and bundled-private implementation changes. Because the contributor checker ran only for pull requests, `pnpm check`, direct pushes to `main`, and direct-provider terminal Stop could miss this requirement. Local agents could pass all tests, complete a workstream, and receive lifecycle-current Stop approval without release intent. Prompt-based retrieval could also omit release documents when the final prompt omitted an accumulated delivery obligation.

Release readiness must derive from repository changes and reviewed Git evidence, independent of model memory, prompt wording, context preparation, workstream status, and terminal lifecycle results.

## Decision

- Add one repository-native `cli_release_completion` inspection. An explicit base commit binds the inspection when supplied. Otherwise, local invocation selects, in order, the merge base with the configured upstream, the latest reachable version tag, or the current worktree. Staged, unstaged, and untracked paths join committed paths after the selected base.
- Permit three successful terminal dispositions: `not_required` when no publishable path changed, `intent_pending` when current reviewed intent covers publishable changes, and `release_prepared` when reviewed intent was consumed into exact prepared bytes. Every other state is `blocked`.
- Prepared-release inspection reads valid intent from the base tree and intent additions in at most 512 comparison commits. At most 128 unique reviewed intents may participate. It replays the pre-1.0 impact policy and requires the exact CLI version, deterministic current release note, release-manifest version, and SBOM component version. Manual version edits and unmatched notes are not preparation evidence.
- `pnpm check` invokes the completion inspection. Pull-request CI uses the pull-request base. Direct-main CI and release preparation use the push-before commit. The same implementation owns every decision; workflows must not reimplement path or version policy.
- Before preparing release bytes, the workflow creates its local release branch at the exact checked-out source revision, configures `origin/main` as its upstream, and verifies that their merge base equals that source. The nested `pnpm check` therefore inspects consumed intent from the release source tree. An older tag reachable from a detached checkout must not introduce previously consumed intent into the new release-note comparison. An upstream mismatch fails before preparation or remote branch writes.
- AGENTS routes release-affecting work to the version-management guide and ADR-0221 and requires the base-bound completion command before an agent claims completion. This supports discovery but is not the enforcement authority.
- Public output retains the base commit, base-selection kind, changed-path count and set digest, intent IDs, impacts, versions, and bounded diagnostics. It excludes repository paths, source bytes, commands, prompts, provider output, credentials, and unrestricted errors.
- The inspection creates no event or durable state and grants no tag, GitHub, npm stage, approval, publication, provider, Hub, or Orca authority. Direct-provider Stop verifies repository lifecycle, not repository-specific release readiness.

## Failure meaning

`missing_release_intent` means publishable work lacks current intent. A prepared-release failure distinguishes missing historical intent, unconsumed intent, version mismatch, release-note mismatch, and generated-metadata mismatch. An invalid or excessively old base fails before success. Failure changes no files and prevents the enclosing check or workflow from claiming completion.

## Consequences

Prompt retrieval and session compaction can no longer be the sole route to the release contract. Direct local work and direct-main pushes receive the same fail-closed decision as pull requests. Release preparation remains separate from tag creation and publication. Provider-neutral Core execution remains independent of Lervo's public-package policy.

## Verification

Fixtures cover dirty work without intent, pending intent, exact consumed preparation, manual version bypass, automatic upstream-base selection, pull-request wiring, direct-main wiring, and release-workflow wiring. The full repository check runs the completion inspection before architecture, build, test, distribution, documentation, and brand verification.

A detached-checkout regression retains an older reachable tag and a previously consumed release. It reproduces a release-note mismatch, then proves that the exact source-bound upstream accepts only the current prepared release. Workflow checks require this branch and base validation before preparation.

## References

- [Reviewed CLI release preparation](0221-reviewed-cli-release-preparation.md)
- [CLI version and release management](../../../distribution/cli-version-management.md)
- [Execution and evidence specification](../../../specifications/execution.md)
