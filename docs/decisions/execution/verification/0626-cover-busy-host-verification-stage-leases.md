# ADR-0626: Cover busy-host verification with a bounded stage lease

- Status: `accepted`
- Decision date: 2026-09-28

## Context

The second installed version-nine normalization apply passed isolated-workspace preparation, lint, type checking, and the first two full-test shards. Shard three passed 1,285 tests but failed the eight-scenario native owner recovery test at its explicit 30-second limit; cleanup then reported `ENOTEMPTY`.

Verification ran from 11:35:28 to 12:00:24 UTC. The stage was claimed at 11:32:23 UTC with a 30-minute outbox lease. Even if the test had passed, the unrun fourth shard would have had less than two minutes before expiry. A passing command after expiry could not be acknowledged because the owner rechecks the exact lease generation after stage execution.

## Decision

The convergence owner now claims a 60-minute stage lease. The 24-hour outbox maximum remains unchanged. This bounded extension covers the measured full-suite run and a fourth shard while preserving exact worker, claim-time, attempt, event-hash, and expiry fencing. A focused owner test advances its clock by 31 minutes during one stage and requires a current stage receipt. Before using any configured suite that can exceed 60 minutes for installed acceptance, separately implement stage-lease renewal with compare-and-swap fencing.

Test-only deadline changes preserve existing assertions:

- The parameterized native owner recovery test now allows 90 seconds. It retains all eight scenarios, real Git workspace operations, migration, native-owner cycles, and receipt recovery.
- The next installed apply exposed two more full-worker integration tests whose 60-second limits were insufficient under concurrent host load. They now allow 180 seconds and retain provider, review, restart, apply, and rejection assertions.
- The next installed version-nine run passed preparation, lint, type checking, and shard one. Shard two passed 1,068 tests, but its `writing_rework` native completion scenario reached the explicit 180-second deadline after exercising the 14-cycle full-runtime fixture. That test now allows 300 seconds with all assertions intact. This adjustment is not evidence of a passing installed apply.

The version-nine suite command limit remains 1,800 seconds per shard, and the reviewed suite hash is unchanged. Success requires installation of a Node runtime containing the longer owner lease and a passing full suite.

## Verification and limits

Installed failures remain failed results. Focused WSL owner and native recovery tests passed 14/14. After the 180-second adjustment, the two full-worker test files passed their three targeted scenarios. The r159 Node artifact containing the 60-minute lease is installed and reached ready health. Quality, documentation, and task-base release checks must pass after the final edits.

The subsequent installed shard-two failure is retained as verification `ver_63662da6c9c43602`, result `sha256:6986f5f0db88edb93dca94d3f1e32490e597e0e057f4b06d42b4858ea16e200f`, at 13:35 UTC. Its shard-two command failed after 765.78 seconds; shards three and four did not run. After the 300-second adjustment, targeted `writing_rework` repeats passed 1/1 on macOS in 37.51 seconds and WSL in 91.50 seconds.

At this decision point, a passing installed normalization apply, the fourth shard, and a current lifecycle receipt remain unobserved. An installed four-shard pass is still required.

## Responsibility review

The convergence owner controls only durable stage admission and settlement. Each touched test file owns one cohesive full-worker fixture family; deadline changes preserve assertions and package boundaries. No provider-specific behavior, source roots, review authority, event fields, or user-owned content changes.

## References

- [ADR-0625](0625-prepare-isolated-candidate-verification-workspaces.md)
- [Background convergence roadmap](../../../roadmap/knowledge/autonomous-background-convergence.md)
