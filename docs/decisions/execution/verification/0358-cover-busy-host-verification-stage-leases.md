# ADR-0358: Cover busy-host verification with a bounded stage lease

- Status: `accepted`
- Decision date: 2026-09-28

## Context

The second installed version-nine normalization apply passed isolated-workspace preparation, lint, type checking, and the first two full-test shards. Its third shard passed 1,285 tests and failed one eight-scenario native owner recovery test at that test's explicit 30-second limit. Cleanup then reported `ENOTEMPTY`. Verification ran from 11:35:28 to 12:00:24 UTC, and the stage had been claimed at 11:32:23 UTC with a 30-minute outbox lease. Even if the test passed, the unrun fourth shard would have had less than two minutes before lease expiry. A passing command result after that expiry could not be acknowledged because the owner checks the exact lease generation again after stage execution.

## Decision

The convergence owner now claims a 60-minute stage lease. The 24-hour outbox maximum remains unchanged; this bounded extension covers the measured full-suite run and a fourth shard without weakening exact worker, claim-time, attempt, event-hash, or expiry fencing. A focused owner test advances its clock by 31 minutes during one stage and requires a current stage receipt. If a configured suite can exceed 60 minutes, stage-lease renewal with compare-and-swap fencing needs a separate implementation before that suite is used for installed acceptance.

The parameterized native owner recovery test now has a 90-second explicit test limit. It still runs all eight scenarios, real Git workspace operations, migration, native-owner cycles, receipt recovery, and all existing assertions. The next installed apply exposed two more full-worker integration tests whose 60-second limits were too short under concurrent host load. Their explicit limits are now 180 seconds; their provider, review, restart, apply, and rejection assertions remain intact. These changes affect tests only. The version-nine suite command limit remains 1,800 seconds per shard, and its reviewed hash is unchanged. Installation of a Node runtime containing the longer owner lease and a passing full suite are required before claiming success.

The next installed version-nine run passed preparation, lint, type checking, and shard one. Shard two passed 1,068 tests but its `writing_rework` native completion scenario reached the explicit 180-second deadline after exercising the 14-cycle full-runtime fixture. That test now allows 300 seconds with all assertions intact; the 1,800-second shard command limit and reviewed suite hash remain unchanged. This is a test-only deadline adjustment, not evidence that the installed apply passed.

## Verification and limits

The installed failures are retained as failed results. Focused WSL owner and native recovery tests passed 14/14; the two full-worker test files passed their three targeted scenarios after the 180-second adjustment. The r159 Node artifact containing the 60-minute lease is installed and reached ready health. Quality, documentation, and task-base release checks must pass after the final edits. An installed passing normalization apply, the fourth shard, and a current lifecycle receipt remain unobserved at this decision point.

The subsequent installed shard-two failure is retained as verification `ver_63662da6c9c43602`, result `sha256:6986f5f0db88edb93dca94d3f1e32490e597e0e057f4b06d42b4858ea16e200f`, at 13:35 UTC. Its shard-two command failed after 765.78 seconds; shard three and four did not run. Targeted `writing_rework` repeats passed 1/1 after the 300-second adjustment on macOS in 37.51 seconds and WSL in 91.50 seconds. An installed four-shard pass is still required.

## Responsibility review

The convergence owner controls only durable stage admission and settlement. Each touched test file owns one cohesive full-worker fixture family; the changed limit leaves the assertions and package boundaries intact. No provider-specific behavior, source roots, review authority, event fields, or user-owned content changes.

## References

- [ADR-0357](0357-prepare-isolated-candidate-verification-workspaces.md)
- [Background convergence roadmap](../../../roadmap/knowledge/autonomous-background-convergence.md)
