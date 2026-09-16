# Responsibility recovery

## Hashes and binding history

An event's `responsibilityArtifactHash` addresses raw CAS bytes. The reader verifies those bytes before decoding and validating `WorkResponsibilityV1`, then computes a separate responsibility contract hash. Node compares the contract hash with the action plan's `responsibilityArtifactHash`. Valid JSON formatting differences can change the CAS hash without changing the contract hash; the hashes are not interchangeable.

`predecessorBindingHash` identifies the preceding responsibility contract hash. The first binding requires null. Every successor and its artifact's predecessor field must match the preceding recovered contract. Assignment and workstream revisions cannot regress; bindings cannot claim future workstream revisions.

The reader checks assignment identity, executor, reviewer, role/version/hash, project, workstream, supervision, and owner against the exact artifact and scope. The latest binding must belong to the installed mandate or an exact reviewed predecessor in the same installation chain.

## Historical recovery

Historical recovery:

- Validates every installation artifact and predecessor.
- Requires the old binding to precede its first successor installation.
- Rechecks the complete supervision history after asynchronous reads.
- Preserves the original binding event and CAS bytes.

Unknown mandates, late old-mandate bindings, changed installation history, and a mismatched current owner reject recovery. Historical visibility grants no execution authority: new effects require the current mandate, exact policy admission, and a valid assignment lease. Owner reasoning may validate earlier admitted observations but cannot reuse an earlier mandate's decision as a current proposal. Those observations remain in resource accounting. The reader does not implement ownership transfer.

Recovery requires the complete relevant chain. An orphan, conflicting binding, missing or corrupt artifact, unsupported document, or invalid latest binding rejects recovery without fallback to an older responsibility. After asynchronous CAS reads, the reader rechecks binding history and rejects concurrent changes.

## Bounds and validation

Recovery uses the existing indexed supervision stream, bounded to 4,096 events, and the existing 256 KiB artifact read bound. It adds no event fields, writer version, projection, or durable state. Events retain identifiers and hashes; task prose and paths remain in governed CAS artifacts. Recovery neither deletes evidence nor creates a replacement binding.

Tests cover independent CAS and contract hashes, exact predecessor recovery, missing bindings, revision regression, future workstream claims, role/owner/mandate mismatch, corrupt bytes, concurrent append, and Node rejection of stale adapter documents after a successor is recorded.
