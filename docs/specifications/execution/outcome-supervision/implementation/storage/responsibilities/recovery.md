# Responsibility recovery and Node admission

## Hashes and history

The event's `responsibilityArtifactHash` addresses raw CAS bytes. The reader verifies those bytes before decoding and validating `WorkResponsibilityV1`, then computes a separate responsibility contract hash. Node compares that contract hash with the action plan's `responsibilityArtifactHash`. Valid JSON formatting differences can change the CAS hash without changing the contract hash; the hashes must not be substituted.

`predecessorBindingHash` identifies the preceding responsibility contract hash. The first binding requires null. Every successor, including its artifact's predecessor field, must match the preceding recovered contract. Assignment and workstream revisions cannot regress, and bindings cannot claim future workstream revisions.

The reader checks assignment identity, executor, reviewer, role/version/hash, project, workstream, supervision, and owner against the exact artifact and scope. The latest binding must belong to the currently installed mandate or an exact reviewed predecessor in the same installation chain. Historical recovery:

- Validates every installation artifact and predecessor.
- Requires the old binding to precede its first successor installation.
- Rechecks the complete supervision history after asynchronous reads.
- Preserves the original binding event and CAS bytes.

Unknown mandates, late old-mandate bindings, changed installation history, or a mismatched current owner reject recovery. Historical visibility grants no execution authority: new effects require the current mandate, exact policy admission, and a valid assignment lease. Owner reasoning validates earlier admitted observations but never reuses an earlier mandate's decision as a current proposal. Those observations remain in resource accounting. The reader does not implement ownership transfer.

Recovery requires the complete relevant chain. An orphan, conflicting binding, missing or corrupt artifact, unsupported document, or invalid latest binding rejects recovery without falling back to an older responsibility. The reader rechecks binding history after asynchronous CAS reads and rejects concurrent changes.

## Node admission

Within its owner session, Node revalidates local mandate authority and reads the canonical responsibility for the readiness adapter's assignment. Both the adapter's responsibility and the latest canonical contract must match the reviewed action plan. Node uses the recovered canonical document for repository readiness checks and repeats recovery during final execution preflight.

No binding or a changed contract rejects admission with `supervision_readiness_changed`. Other corrupt-history or artifact failures reject recovery. Failure before effect invocation starts no execution effect. Failure inside final execution preflight retains the existing decision as uncertain for reconciliation; it does not prove an external effect occurred. The effect adapter still owns final exact admission at its commit boundary.

Native initial, revised, and recovery claims reserve the existing five-second admission observation window before the absolute task completion deadline. They round the remaining duration down to whole seconds, cap each claim at five minutes, and reject less than five seconds of usable lease time. The canonical claim boundary still checks actual acquisition and expiry; the allowance does not extend any task deadline.

## Bounds and validation

Recovery uses the existing indexed supervision stream, bounded to 4,096 events, and the existing 256 KiB artifact read bound. It adds no event fields, writer version, projection, or durable state. Events retain identifiers and hashes; task prose and paths remain in governed CAS artifacts. Recovery neither deletes evidence nor creates a replacement binding.

Tests cover independent CAS/contract hashes, exact predecessor recovery, missing bindings, revision regression, future workstream claims, role/owner/mandate mismatch, corrupt bytes, concurrent append, and Node rejection of stale adapter documents after a successor is recorded.
