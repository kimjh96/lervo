# ADR-0624: Bound test deadlines for busy-host shards

- Status: `accepted`
- Decision date: 2026-09-28

## Context

Version seven's fork-backed shards removed the thread-worker `process.umask()` failure. Its second macOS shard passed once, then failed two Node runtime tests at Vitest's default 5,000-millisecond per-test deadline during concurrent host work. Running those two files with a 15,000-millisecond deadline passed all 14 tests. Test selection and assertions were unchanged; host scheduling made the default deadline an unreliable verification boundary.

## Decision

Preserve version seven as an immutable suite. Add `repository.default.v8`, retaining version seven's four sequential fork-backed shards, four workers, risk classification, related-test selection, 1,800-second command limits, and bounded output.

The version-eight pure plan adds exactly one `--testTimeout=15000` argument to the version-seven plan and fails closed if its predecessor already sets a test deadline. The default applies to both related and full selections. Commands still fail for any test exceeding its applicable deadline, any failing assertion, or any shard exceeding its 1,800-second command limit.

Vitest per-test declarations take precedence over the default:

- The background worker's tracked-secret test requires up to 90 seconds on the loaded WSL host, preserving its privacy assertions.
- Two broader worker tests run multiple complete review and materialization cycles. The installed four-worker shard exhausted their former 90-second limits after 1,009 other tests passed. Both now have explicit 240-second limits.

Assertions and the shard's 1,800-second command limit remain unchanged.

The version-eight suite requires a new exact reviewed delegation before installation. Its result cannot be inferred from a passing version-seven shard or focused tests.

## Verification and limits

- Focused tests verify retained fork and shard arguments, related selection, the exact default deadline, and invalid shard rejection.
- The two previously timing-sensitive Node runtime files and version-eight plan tests passed together on macOS: 16 tests with the 15-second default.
- Mac shard two passed 217 files and 1,069 tests.
- The first installed WSL shard failed when the worker test's explicit 30-second limit expired. A direct repeat reproduced one failure in that test after 1,010 other tests passed.
- A later installed shard passed lint and typecheck, then hit two 90-second worker-test limits after 1,009 tests passed.

Full installed version-eight results remain required for completion.

## Responsibility review

The version-eight plan owns only the pure deadline change. Its short runner owns process execution and bounded diagnostics. The suite YAML owns ordered verification commands and limits. No provider adapter, canonical document, or knowledge state contract changes.

## References

- [ADR-0623](0623-use-fork-backed-runtime-shards.md)
- [Autonomous background knowledge convergence roadmap](../../../roadmap/knowledge/autonomous-background-convergence.md)
