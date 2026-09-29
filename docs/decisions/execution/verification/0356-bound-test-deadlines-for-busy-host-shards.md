# ADR-0356: Bound test deadlines for busy-host shards

- Status: `accepted`
- Decision date: 2026-09-28

## Context

Version seven's fork-backed shards removed the thread-worker `process.umask()` failure. Its second macOS shard passed once, then a repeat under concurrent host work failed two Node runtime tests at Vitest's default 5,000-millisecond per-test deadline. Running those two files with a 15,000-millisecond deadline passed all 14 tests. The selected test files and assertions did not change; the host schedule made the default deadline an unreliable verification boundary.

## Decision

Preserve version seven as an immutable suite. Add `repository.default.v8`, retaining its four sequential fork-backed shards, four workers, risk classification, related-test selection, 1,800-second command limits, and bounded output. The version-eight pure plan adds exactly one `--testTimeout=15000` argument to the version-seven plan and fails closed if its predecessor already sets a test deadline. It applies the same default deadline to related and full selections. The command still fails for any test that exceeds its applicable deadline, any failing assertion, or any shard that exceeds its 1,800-second command limit.

Vitest's per-test declarations still take precedence over the default. The background worker's tracked-secret test requires up to 90 seconds on the loaded WSL host while preserving its privacy assertions. Two broader worker tests run multiple complete review and materialization cycles; the installed four-worker shard exhausted their former 90-second limits after 1,009 other tests passed. Those two tests now have explicit 240-second limits. Their assertions and the shard's 1,800-second command limit remain unchanged.

The version-eight suite needs a new exact reviewed delegation before installation. Its result cannot be inferred from a passing version-seven shard or from focused tests.

## Verification and limits

Focused tests verify the retained fork and shard arguments, related selection, exact default deadline, and invalid shard rejection. The two previously timing-sensitive Node runtime files and the version-eight plan tests passed together, 16 tests total, with the 15-second default on macOS. Mac shard two passed 217 files and 1,069 tests. The first installed WSL shard failed when the worker test's explicit 30-second limit expired; a direct repeat reproduced one failure in that test after 1,010 other tests passed. A later installed shard passed lint and typecheck, then hit two 90-second worker-test limits after 1,009 tests passed. Full installed version-eight results remain required for completion.

## Responsibility review

The version-eight plan owns only the pure deadline change; its short runner owns process execution and bounded diagnostics. The suite YAML owns ordered verification commands and limits. No provider adapter, canonical document, or knowledge state contract changes.

## References

- [ADR-0355](0355-use-fork-backed-runtime-shards.md)
- [Autonomous background knowledge convergence roadmap](../../../roadmap/knowledge/autonomous-background-convergence.md)
