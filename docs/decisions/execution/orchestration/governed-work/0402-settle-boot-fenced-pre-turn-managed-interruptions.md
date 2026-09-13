# ADR-0402: Settle boot-fenced pre-turn managed interruptions

- Status: accepted
- Decision date: 2026-09-14

## Context

An installed supervised worker can durably reserve and bind a role before the provider adapter starts. A host reboot then leaves the managed request without a terminal or usage receipt. Existing empty-run and reservation-only supersession rules correctly reject that partial request, so the owner cannot safely retry the leased assignment. Treating an expired lease, missing process or missing usage as zero would erase uncertainty.

## Decision

Add a manually invoked, Node-hosted recovery for exactly the five-event pre-turn prefix. It requires the original admitted managed plan, a current eligible mandate and exclusive owner lease. The host adapter reads the local Linux journal's ordered boot inventory and current kernel boot ID. Every prefix event must fall within one completed boot, followed by a successor boot. The CAS diagnostic pins each original event ID, type and hash, the incident time, the old and successor boot boundaries, current boot ID, inventory digest and observation time. The owner-fenced writer atomically checks the event head, unchanged run history, same current boot and five-second witness freshness before appending `run.failed`.

The terminal event uses schema version 1 and system actor; its required payload is exactly `failureCode: interrupted_before_turn`, `retryable: true`, and `diagnosticDigest`. The CAS diagnostic schema is `work.managed_pre_turn_failure` version 1 with one `{code: interrupted_before_turn, phase: recovery, retryable: true}` failure, five pinned `runEvents`, and `host.boot_transition_witness` version 1. Events and CAS contain identifiers, hashes, boot times and IDs only; no task prose, credentials or source bytes. Corrupt or unavailable CAS, changed history, missing journal, overlapping boots, lost authority, late worker, or failed write means uncertainty and no retry admission.

Readers count the proven pre-turn run outside the provider-usage population because the managed provider turn cannot start before `adapter.started` and the reboot fences the old process. They preserve the canonical run and reservation, never fabricate a provider usage receipt, and keep all other missing usage blocking. Assignment reopening, new provider execution, independent acceptance and Discord delivery retain their separate gates. The host journal adapter remains in Node runtime; provider-neutral controller contracts do not depend on Linux or Codex.

## Consequences

The original interrupted assignment may be proposed for a separately reviewed safe retry after a valid terminal. This recovery cannot resolve a provider session that started, a tool-capable run with uncertain effects, or a timeout without an observed host boot transition.

## References

- [Assignment recovery](../../../../specifications/execution/outcome-supervision/implementation/managed-execution/assignment-recovery.md)
- [Admission and readiness](../../../../specifications/execution/outcome-supervision/implementation/managed-execution/task-observation/admission-and-readiness/admission.md)
