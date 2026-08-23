# ADR-0043: Signed policy and command-bound approval that cannot relax local limits

- Status: accepted
- Decision date: 2026-08-19

## Context

`require_approval` remained closed without a verified approval source. Remote commands could be reevaluated after denial but could not prove which policy snapshot and human approval authorized the exact command.

Hub policy must not weaken local restrictions. Approvals must not cross commands or capabilities, and expiry and revocation must survive restart while local execution remains Hub-independent.

## Decision

### Distinct signed sources

`@lervo/policy-contract` owns three canonical sources with distinct Ed25519 domains:

- `PolicySnapshot`: project and identity, sequence, predecessor, issue and expiry times, and role, risk, and capability rules.
- `PolicyApproval`: snapshot ID and hash, command ID, hash, and signer key, capability, approved relative path, approver subject hash, and issue and expiry times.
- `PolicyApprovalRevocation`: approval ID, revocation time, and bounded reason.

IDs are derived from canonical sources excluding the ID. Duplicate rules or IDs are rejected. An approval cannot outlive its snapshot or command.

Each envelope must verify with a project-scoped trust key authorized for `snapshot`, `approval`, or `revocation`; signatures cannot cross purposes.

### Atomic authenticated bundle apply

Policy synchronization runs only over authenticated transport that verifies the destination and Hub peer.

Validate one snapshot and no more than 64 approvals and 64 revocations, including signatures and relationships, before one `applyVerifiedBundle`. Never apply a partial bundle.

Bind `@lervo/policy-sqlite` to the project and identity and store each envelope in a separate append-only table. A new snapshot must be the exact next sequence and name the current predecessor. An empty node may bootstrap from a current signed snapshot; subsequent rollbacks and gaps are rejected.

An exact replay is a no-op. The same ID with different source content is an integrity failure.

### Hub cannot weaken local policy

Merge the current Hub rule with the local decision using `deny > require_approval > allow`. Hub `allow` cannot override local `deny` or `require_approval`. A missing Hub rule preserves the local decision. An invalid or expired installed snapshot closes remote commands.

`require_approval` accepts only a current, unexpired, unrevoked approval matching the exact snapshot, command ID, command hash, signer key, capability, and path. Stored envelopes are reverified against trust during every evaluation. Corruption is a policy failure, not a missing approval.

While awaiting approval, create neither a remote replay reservation nor a terminal Hub rejection. The worker returns `local_deferred/approval_required` and lets the lease expire. After synchronization, reevaluate the same signed command and pass verified command, signer, snapshot, and approval coordinates to the executor.

### Privacy and failures

Policy SQLite stores signed rule metadata, command and hash coordinates, and the approver subject hash. It does not store requests, raw identity or email, approval prose, credentials, payloads, or exceptions. Revocations use only three fixed reason codes.

Invalid bundles, signers, scope, purpose, or signatures store nothing. Snapshot rollback or gaps, content conflicts, capacity failures, and transaction failures preserve current state and close as `policy_store_failed`. Expiry and revocation remain immutable evidence evaluated against time.

This decision adds no event; policy records do not replace capability, file, or run evidence.

Fixtures cover approval required before payload access, approved execution after restart, terminal duplicates, revocation and expiry, stronger local denial, wrong signing purpose, rollback, offline or peer mismatch, privacy, and malformed contracts.

## Consequences

Policy distribution and approval are provider- and transport-neutral, while local limits remain authoritative. ADR-0044 connects approvals to managed writes. ADR-0045 adds Hub authoring and HTTP synchronization.
