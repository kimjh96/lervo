# ADR-0352: Escalate opaque runtime changes

- Status: `accepted`
- Decision date: 2026-09-03

## Context

ADR-0351 added Vitest related-test selection to the automatic repository verification floor. That
selection is fast and authoritative for dependencies visible in Vitest's static graph, but the
repository also executes files through subprocesses and reads assets, fixtures, manifests, and
workflow definitions at runtime. A change to one of those files can affect tests without appearing
as a static import. Treating a no-test selection as runtime proof would overstate the evidence.

Running all tests for every change is also disproportionate. The observed one-worker regression
run covered 482 test files in 384.66 seconds. The default path therefore needs a bounded,
repository-authored escalation policy without creating a competing source dependency graph.

## Decision

Preserve `repository.default` through `repository.default.v3` as immutable historical evidence
definitions. Add `.lervo/verifications/repository.default.v4.yaml`, retaining lint and type checking
and replacing the fixed related-test command with
`node scripts/run-changed-runtime-verification.mjs`.

The runner observes tracked, staged, modified, and untracked paths relative to `HEAD`. It uses
NUL-delimited Git output, a 1 MiB bound per Git observation, and a maximum of 4,096 distinct paths.
The pure verification-plan policy chooses one of two exact commands:

- ordinary source, changed-test, documentation, and evidence changes run Vitest with
  `--changed HEAD --passWithNoTests`; and
- workspace or test configuration, repository execution scripts, GitHub workflow runtime
  definitions, runtime-loaded assets or fixtures, and non-source files below `apps/` or `packages/`
  run the complete Vitest suite.

Both modes retain one worker, the dot reporter, a 900-second suite-command timeout, and a 1 MiB
managed output bound. The runner emits a bounded JSON summary of the selected mode and up to 32
escalation triggers before starting Vitest. The summary is diagnostic output, not a new canonical
event or dependency index.

The policy does not attempt to infer imports, test ownership, or affected packages. Vitest remains
the only related-test dependency graph. New opaque runtime path classes must be added as named,
tested policy reasons; a provider, package, or feature branch in core execution is not permitted.

## Failure and evidence meaning

Failure to observe Git paths, an invalid repository-relative path, exceeding an observation bound,
failure to start Vitest, a terminating signal, timeout, or a nonzero test exit fails the managed
verification command. `related` proves only that Vitest completed the graph-visible selection.
`full` proves only the local repository test suite under the recorded environment. Neither proves
an external service, provider, network, packaging, or release workflow was exercised.

The version 4 suite ID and content hash remain part of result identity. Results from versions 1
through 4 must not be pooled without retaining those distinct meanings.

## Responsibility review

`verification-plan.mjs` owns only the pure risk and command policy. `git-changes.mjs` owns only the
bounded Git observation adapter. The root runner is a short composition entrypoint responsible for
diagnostic rendering, child-process invocation, and exit translation. No Lervo runtime package,
provider adapter, or shared public API depends on this repository-local policy.

## Verification

The focused policy and Git-adapter suite passed 18 cases, including source-path retention, every
named escalation class, future Vitest and TypeScript configuration names, duplicate inputs,
invalid paths, staged and untracked files, a filename containing a newline, a clean repository,
and Git observation failure.

The new entrypoint selected `full` for this implementation with three
`repository_execution_script` triggers. Its direct run passed 484 test files and 2,484 tests in
357.09 seconds. The exact managed `repository.default.v4` suite then passed with suite hash
`sha256:3b51878b9313a530135a87ae27847e9d6f7e7d4285ba8f05c9054d2748f86bb6` and verification ID
`ver_fede338fbd221ad4`: lint took 1,819 milliseconds, type checking took 5,627 milliseconds, and
risk-based full regression took 332,025 milliseconds. The managed runner bound the observation to
repository revision
`sha256:93c5f28975ae5444d45c041f5b24f97c972066fa40e0197d0598504b398c1a76`.
After the implementation commit, the same entrypoint selected `related` for a clean worktree with
zero changed paths and exited successfully when Vitest found no related test files.

## Consequences

Most source edits retain the fast related-test loop. Changes with known static-graph blind spots
pay the measured full-regression cost automatically, making the evidence boundary safer without
making all changes equally expensive. The policy is intentionally conservative and can evolve by
adding a named rule and focused test in a later immutable suite version.

Real external integrations, distribution behavior, and environment-specific execution still need
their existing focused checks. A successful version 4 default is not release readiness.

## References

- [ADR-0024](../providers/0024-provider-neutral-project-verification.md)
- [ADR-0032](0032-managed-run-project-verification.md)
- [ADR-0176](0176-bounded-verification-result-sources.md)
- [ADR-0350](0350-version-default-repository-static-verification.md)
- [ADR-0351](0351-add-bounded-related-runtime-tests.md)
- [Foundation verification and enhancement handoff](../../../roadmap/foundation-hardening/verification-and-handoff.md)
