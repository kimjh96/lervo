# ADR-0444: Serialize knowledge materialization with managed runs

Status: accepted
Decision date: 2026-09-29
Amended by: [ADR-0483](../../../operations/services/0483-wait-for-live-knowledge-materialization-in-foreground-commands.md) (foreground commands wait for a live owner)

## Context

An installed background normalization apply changed repository bytes while a managed Discord turn held an earlier repository snapshot. The turn reported `unmanaged_change.detected` despite the background writer's reviewed materialization plan. The writer later rolled back. Separating the resident knowledge process and moving snapshot capture into a child do not coordinate these source bytes.

## Decision

`@lervo/project-storage` owns a private, per-repository SQLite source gate in `.lervo/data/repository-source-gate.sqlite`. Managed provider runs acquire a shared read transaction before their first repository snapshot and release it after the run settles. Concurrent managed readers remain possible. Durable knowledge apply and recovery acquire an exclusive transaction around the complete journal and event effect. Rollback journaling prevents an exclusive writer from overlapping an active reader. Process exit releases its SQLite transaction.

Admission is bounded and fails closed:

- A busy knowledge writer records `knowledge_materialization_busy`, follows the existing bounded retry schedule, and changes no repository bytes.
- Busy or invalid managed admission records the existing `repository_snapshot_failed` and starts no provider.
- An invalid writer gate reports `knowledge_source_gate_invalid` and requires attention.
- An interrupted materialization journal blocks new managed reads with `knowledge_recovery_required`; exclusive recovery can still clear it.

The gate never authorizes a source change. Ordinary snapshot comparisons and managed write evidence still apply.

## State, privacy, and verification

The gate file contains one fixed marker and a schema version, with no source path, body, prompt, provider output, credential, or event payload. Transactions are process-local leases; no new canonical event is introduced. The two new normalized failure codes appear only as bounded public status or stage failure values. A crash while holding a read or write lease releases the SQLite transaction; an interrupted knowledge journal still requires the existing explicit recovery check.

Verify concurrent readers, writer exclusion in both directions, no provider start on busy admission, no file mutation on deferred apply, release after a completed run, and journal recovery. Installed acceptance must still show a fresh conversation published while real background convergence is active and a later knowledge apply reaching its reviewed current state.

## References

- [Background convergence runtime](../../../../specs/background-knowledge-convergence/runtime.md)
- [Background convergence roadmap](../../../../roadmap/knowledge/autonomous-background-convergence.md)
