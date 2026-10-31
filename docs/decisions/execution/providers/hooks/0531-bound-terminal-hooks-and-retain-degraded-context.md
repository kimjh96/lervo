# ADR-0531: Bound terminal hooks and retain degraded context

Status: `accepted`
Decision date: 2026-10-25
Amends: [ADR-0327](0327-availability-safe-unmanaged-terminal-hooks.md), [ADR-0451](../../../knowledge/repository/canonicalization/0451-keep-terminal-hooks-off-the-developer-critical-path.md)

## Context

The owner reported that Claude Code discarded a UserPromptSubmit result in axli after its 30-second timeout. This report is not an installed reproduction in this checkout. The shared hook command discards internal errors and returns empty success. Its failed stage observation has no cause. Git ignored-path discovery also returns an empty set after any error, so snapshot capture can descend into ignored trees.

The snapshot already stops at the first entry beyond its 20,000-file bound. It does not traverse the whole tree before checking that bound. It has no hook deadline. Compact context captures this snapshot before preparing publication policy, applied instructions, and workstream context, so a snapshot failure loses those independent lines too.

The requested ADR-0530 example is absent from this checkout. This record follows the accepted decision format used by ADR-0499. The terminal-hook decision route has five existing documents, below its 24-document leaf bound.

## Decision

Use one 15,000 ms hook budget, measured from shared-command entry with a monotonic clock. Repository snapshots share an absolute deadline at half that budget. Main stages share a deadline at two thirds. Failure recording and response output use the remaining time. Base reads start only after prompt preparation fails and share a deadline one sixth of the budget after fallback starts, capped by the remaining hook budget. Healthy prompts do not perform these extra reads. Sequential stages do not renew these budgets. On failure, cancel and settle concurrent stage wrappers before finalizing their recorder, so a still-active sibling cannot suppress the failure event.

Pass the snapshot deadline through the terminal snapshot boundary, including nested Stop and knowledge-cache confirmation captures. Bound Git subprocess timeouts by the remaining capture time. Check the deadline before traversal, between entries, after reads, and before returning a complete snapshot. Preserve immediate file-count and byte-count rejection. A failed capture publishes no partial snapshot.

Git ignored-path discovery returns either `available` with paths or `unavailable`. Only a successful Git result, or an explicit non-repository result from the Git worktree probe, can establish an empty set. An unavailable result stops capture before file traversal. A Git failure never grants permission to traverse ignored trees.

Both providers keep compact preparation by default. `LERVO_TERMINAL_CONTEXT=retrieval` preserves ADR-0451’s opt-in provider projection and retrieval path under the same deadlines. Slow retrieval can degrade when the shared deadline expires; installed retrieval latency remains unqualified. The new failure and degradation paths add no provider call. Stop skips compact prefetch in retrieval mode, and background maintenance stays detached.

Prepare the base context independently of snapshot and knowledge inspection. On failure, return the AGENTS.md pointer and a short degraded reason. Retain publication policy, complete applied owner clauses, and the verified recorded workstream headline only when their bounded local reads succeed. Label workstream freshness uninspected and omit its next actions, blockers, decisions, and approvals. Omit knowledge health, freshness counts, recommendations, and retrieved documents. Preserve observed worker attachment guidance when available.

A degraded response creates no new `terminal.context.prepared` event or activation receipt for missing snapshot evidence. Earlier successful writes can remain if a later stage fails; preparation never establishes provider delivery. Failure recording is best effort when project storage is unavailable or the writer predates stage events. No hook can promise durable evidence when its storage cannot accept a write.

Stop preserves the existing lifecycle decision: an attached worker with `action_required`, including returned inspection failures or invalid workstream state, remains blocked; a non-worker remains allowed with its reason recorded. Checkpoint or pause failure sets `workspace_checkpoint_failed` and blocks the worker. Capture errors are caught inside the measured operation, recorded as `event_persistence_failed`, and do not bypass the isolation decision. Recovered failures may carry `failureReason` on a completed observation. Unexpected thrown inspection or persistence errors retain the main branch’s empty-success fallback with a failed stage observation when storage permits. An unmatched or re-entrant Stop remains empty success without completion claims. Rejected ingress remains nonzero. The generated executable flushes its response and exits, so abandoned asynchronous handles cannot keep the hook alive after a deadline race. Successful paths await receipt persistence, stage events, and storage closure. Detached launches await process creation, not worker completion. Deadline races may abandon in-flight writes; no durable completion is claimed for those writes. JavaScript deadlines cannot interrupt a blocked event loop; installed latency remains a separate verification gate.

## State, events, privacy, and failure meaning

No new event type or durable state store is added. `execution.stages.observed` gains optional `failureReason`. New failed hook observations require it at the producer boundary. Historical records without it remain readable. The field accepts only these codes:

| Code                                    | Producer and meaning                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| `repository_snapshot_limit_exceeded`    | Snapshot file or byte bound was exceeded.                                            |
| `repository_snapshot_deadline_exceeded` | Snapshot checks or its enclosing stage deadline expired.                             |
| `repository_snapshot_failed`            | Other snapshot safety, policy, read, or consistency failure.                         |
| `git_ignored_paths_unavailable`         | Git ignored paths could not be established; traversal did not start.                 |
| `knowledge_inspection_failed`           | Context preparation failed, or Stop returned an internal knowledge-inspection issue. |
| `hook_deadline_exceeded`                | Another hook stage or observation deadline expired.                                  |
| `repository_discovery_failed`           | The initialized project root could not be resolved.                                  |
| `lifecycle_inspection_failed`           | Workspace attachment or Stop expectation/lifecycle inspection failed internally.     |
| `event_persistence_failed`              | Context, receipt, turn, capture queue, checkpoint, or stage persistence failed.      |
| `hook_input_invalid`                    | Arguments, contract, or provider input were rejected.                                |
| `unexpected_error`                      | An error outside a more specific boundary occurred.                                  |

The existing required observation fields and at most 32 stage results remain unchanged. Valid input supplies the observed hook event and hashed session coordinates. Rejected ingress has no trustworthy session or hook event; it uses opaque unattributed coordinates and omits `terminalHook`. It never guesses a provider event.

The reason field contains no messages, paths, stacks, prompt text, credentials, or provider configuration. The public degraded line contains only a closed code. It reports skipped checks, not successful inspection, injection, use, or completion. Private snapshot caches retain their existing ownership and replacement rules. A deadline is invocation-local and never participates in cache identity.

## Verification

Focused tests are written in:

- `apps/cli/test/terminal-hook-failure-reasons.test.ts`: both providers, snapshot reasons, knowledge failure, shared deadline, Stop failure, expectation lookup failure, and no base reads on healthy preparation.
- `apps/cli/test/terminal-degraded-context.test.ts`: independent base lines, omitted freshness claims, failed optional reads, and bounded waiting.
- `apps/cli/test/terminal-stop-hook-failures.test.ts`: checkpoint/pause errors, returned inspection failures for workers and non-workers, capture failure before isolation blocking, and mode-dependent prefetch.
- `apps/cli/test/terminal-stage-failure-schema.test.ts`: closed codes, historical records, retryable finalization, and worker isolation error identity.
- `packages/orchestrator/test/repository-snapshot-git.test.ts`: successful empty results, subprocess timeout, bounded subprocess options, and unsafe Git coordinates.
- `packages/orchestrator/test/repository-snapshot-failures.test.ts`: empty versus unavailable Git results, no traversal after Git failure, immediate entry limit, and deadline checks.
- `apps/cli/test/terminal-integration.test.ts`: retrieval selected by the environment variable, compact defaults without provider projection, publication policy, worker isolation, and unsupported delivery/use claims.

The owner has prohibited test execution for this task. These tests are not passing evidence. Run them after permission, then requalify installed Codex and Claude Prompt/Stop latency on a large repository. Build checks enforce the existing 8 MiB generated-runtime budget. Type, format, quality, document, structural, build, and release checks are reported separately from tests and installed acceptance.
