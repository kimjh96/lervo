# Responsibility recovery and Node admission

## Hashes and history

An event's `responsibilityArtifactHash` addresses raw CAS bytes. Before decoding and validating `WorkResponsibilityV1`, the reader verifies those bytes and then computes a separate responsibility contract hash. Node compares the contract hash with the action plan's `responsibilityArtifactHash`. Valid JSON formatting differences can change the CAS hash without changing the contract hash, so the hashes are not interchangeable.

`predecessorBindingHash` identifies the preceding responsibility contract hash. The first binding requires null. Every successor and its artifact's predecessor field must match the preceding recovered contract. Assignment and workstream revisions cannot regress, and bindings cannot claim future workstream revisions.

The reader checks the assignment identity, executor, reviewer, role/version/hash, project, workstream, supervision, and owner against the exact artifact and scope. The latest binding must belong to the installed mandate or an exact reviewed predecessor in the same installation chain.

Historical recovery:

- Validates every installation artifact and predecessor.
- Requires the old binding to precede its first successor installation.
- Rechecks the complete supervision history after asynchronous reads.
- Preserves the original binding event and CAS bytes.

Unknown mandates, late old-mandate bindings, changed installation history, and a mismatched current owner reject recovery. Historical visibility grants no execution authority: new effects require the current mandate, exact policy admission, and a valid assignment lease. Owner reasoning may validate earlier admitted observations but cannot reuse an earlier mandate's decision as a current proposal. Those observations remain in resource accounting. The reader does not implement ownership transfer.

Recovery requires the complete relevant chain. An orphan, conflicting binding, missing or corrupt artifact, unsupported document, or invalid latest binding rejects recovery without fallback to an older responsibility. After asynchronous CAS reads, the reader rechecks binding history and rejects concurrent changes.

## Node admission

Within its owner session, Node revalidates local mandate authority and reads the canonical responsibility for the readiness adapter's assignment. The adapter's responsibility and latest canonical contract must both match the reviewed action plan. Node uses the recovered canonical document for repository readiness checks and repeats recovery during final execution preflight.

No binding or a changed contract rejects admission with `supervision_readiness_changed`. Other corrupt-history or artifact failures reject recovery. A failure before effect invocation starts produces no execution effect. A typed final-preflight failure retains the recorded decision and reports `supervision_preflight_failed`; replay requires independent proof that the effect never started. Post-invocation failures retain uncertain execution for reconciliation. The effect adapter owns final exact admission at its commit boundary.

Native initial, revised, and recovery claims reserve a thirty-second admission margin before the absolute task completion deadline, which covers the latency between the owner's proposal and the fenced acquisition that re-checks the same deadline. They round remaining duration down to whole seconds, cap each claim at five minutes, and reject less than five seconds of usable lease time. A recovery claim whose successor responsibility can no longer hold that margin plus a minimal lease is not materialized; the owner decides again. The canonical claim boundary still checks actual acquisition and expiry. The allowance does not extend the task deadline.

## Bounds and validation

Recovery uses the existing indexed supervision stream, bounded to 4,096 events, and the existing 256 KiB artifact read bound. It adds no event fields, writer version, projection, or durable state. Events retain identifiers and hashes; task prose and paths remain in governed CAS artifacts. Recovery neither deletes evidence nor creates a replacement binding.

Tests cover independent CAS and contract hashes, exact predecessor recovery, missing bindings, revision regression, future workstream claims, role/owner/mandate mismatch, corrupt bytes, concurrent append, and Node rejection of stale adapter documents after a successor is recorded.
