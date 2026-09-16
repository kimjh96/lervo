# Durable transitions and failure proofs

`reopenAssignment` changes an exact completed assignment to queued for rework, or an exact failed assignment to queued for a separately evidenced retry. It preserves previous result references, assignee and failure evidence, increments the assignment revision and retains one current recovery coordinate. Earlier records remain in canonical events and CAS rather than accumulating in the assignment record.

`lastLeaseGeneration` preserves the greatest acquired generation after completion clears the live lease. A successor claim increments it and receives a distinct lease and session. Old records without an observed generation remain readable but cannot be reopened by guessing their former lease. Reopening does not claim a lease, start a provider, accept an artifact or complete a goal.

The scheduler lock protects the exact predecessor compare-and-swap and dependent-work check. If dependent work consumed the completed result, reopening is blocked until that work is reconciled. Failed event recording restores predecessor bytes. Before recording success, the Node rechecks workstream, roster, assignment, workspace, event head, mandate, deadline and owner fence.

## No-tool provider failures

Built-in Node recovery admits rejected, reconciled completion and narrowly evidenced no-tool provider failures. Failed runs require:

- Their original canonical diagnostic ledger.
- One actual read-only session attesting unsupported tool calls, commands and file changes.
- One consistent stop before one failed terminal.
- No effect events.

Only turn, stream, result-collection or result-storage failures qualify. Cancellation, stop, contract, snapshot and telemetry failures remain uncertain. This proof does not cover an ordinary native tool-capable session. Missing usage still blocks token admission.

## Interrupted pre-turn runs

An explicitly invoked Node repair can settle an interrupted managed run whose canonical history is exactly `managed.execution.reserved`, `work.causality.recorded`, `run.requested`, `run.resolved`, and `role.input.bound`, with no adapter start or later run event.

The repair verifies the original admitted decision, exact execution key, current owner lease and eligible mandate. A local Linux journal boot inventory must place every prefix event in one completed boot, show its successor and match the current kernel boot ID.

The writer stores an exact, hash-pinned diagnostic in CAS and appends one owner-fenced `run.failed` with `failureCode: interrupted_before_turn`, `retryable: true`, and the diagnostic digest. Its event head, run prefix and boot ID are rechecked at commit. A missing or malformed diagnostic, unexpected event, overlapping boot, stale authority or late worker remains uncertain.

The terminal proves the old process cannot start a turn after reboot; it does not claim provider-reported usage. Admission excludes this **proven pre-turn run only** from the population requiring provider usage while retaining its reservation, events and assignment history. Other started or partial runs still require their exact usage receipts.

A separate `SupervisedAssignmentRecoveryV2` decision must reopen the expired leased assignment. This repair alone neither starts a retry nor accepts a result.
