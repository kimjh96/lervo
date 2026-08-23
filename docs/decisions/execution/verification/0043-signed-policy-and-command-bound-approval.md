# ADR-0043: Signed policy and command-bound approval that cannot relax local limits

Status: `accepted`
Decision date: 2026-08-19

## Context

`require_approval` remained closed without a verified approval source. Remote commands could be reevaluated after denial but could not prove which policy snapshot and human approval authorized that exact command. Hub policy must not weaken local restrictions, approvals must not cross commands/capabilities, and expiry/revocation must survive restart while local execution remains Hub-independent.

## Decision

### Distinct signed sources

`@lervo/policy-contract` owns three canonical sources with distinct Ed25519 domains:

- `PolicySnapshot`: project/identity, sequence, predecessor, issue/expiry, role/risk/capability rules
- `PolicyApproval`: snapshot ID/hash, command ID/hash/signer key, capability, approved relative path, approver subject hash, issue/expiry
- `PolicyApprovalRevocation`: approval ID, revocation time, bounded reason

Derive IDs from canonical source excluding ID. Reject duplicate rules/IDs. Approval cannot outlive snapshot or command. Verify each envelope with a project-scoped trust key authorized for `snapshot`, `approval`, or `revocation`; signatures cannot cross purposes.

### Atomic authenticated bundle apply

- Policy sync runs only behind authenticated transport and verifies destination/Hub peer.
- Validate one snapshot and at most 64 approvals plus 64 revocations, including signatures and relations, before one `applyVerifiedBundle`; never partial apply.
- Bind `@lervo/policy-sqlite` to project/identity and store each envelope in separate append-only tables.
- New snapshots must be exactly next sequence and name current predecessor. An empty node may bootstrap from a current signed snapshot; afterward reject rollback/gaps.
- Exact replay is no-op; same ID/different source is integrity failure.

### Hub cannot weaken local policy

Merge current Hub rule with local decision using `deny > require_approval > allow`. Hub allow cannot override local deny/approval. Missing Hub rule preserves local decision; invalid/expired installed snapshot closes remote commands.

`require_approval` accepts only a current, unexpired, unrevoked approval matching exact snapshot, command ID/hash/signer key, capability, and path. Reverify stored envelopes against trust on every evaluation; corruption is policy failure, not missing approval.

While awaiting approval, create no remote replay reservation or terminal Hub rejection. Worker returns `local_deferred/approval_required` and lets lease expire. After sync, reevaluate the same signed command and pass verified command/signer/snapshot/approval coordinates to executor.

### Privacy and failures

Policy SQLite stores signed rule metadata, command/hash coordinates, and approver subject hash—not request, raw identity/email, approval prose, credentials, payloads, or exceptions. Revocation uses only three fixed reason codes.

Invalid bundles/signers/scope/purpose/signature store nothing. Snapshot rollback/gap, content conflict, capacity, or transaction failure preserves current state and closes as `policy_store_failed`. Expiry/revocation remains immutable evidence evaluated by time. Add no event; policy records do not replace capability/file/run evidence.

Fixtures cover approval-required before payload, approved execution after restart, terminal duplicate, revocation/expiry, stronger local deny, wrong purpose, rollback, offline/peer mismatch, privacy, and malformed contracts.

## Consequences

Policy distribution and approval are provider/transport-neutral and local limits remain authoritative. ADR-0044 connects approvals to managed writes; ADR-0045 adds Hub authoring and HTTP sync.
