# ADR-0044: Bind signed approval source to managed-write permits

- Status: accepted
- Decision date: 2026-08-19

## Context

Remote policy validated command-bound approval but passed only IDs to executors, while the coordinator always blocked `require_approval`. A boolean bridge could miss expiry, revocation, snapshot replacement, or path mismatch after a run starts.

Local `allow` must continue without the Hub, and provider-specific approval mechanisms cannot determine final authority.

## Decision

- `ManagedRunApprovalAuthorization` carries the verified command source, signer key ID, policy snapshot ID, and approval ID. It never carries a request, credential, approver identity, or reason. It is revalidation input, not authority by itself.
- `PolicyApproval` binds 1–16 normalized relative paths and cannot widen a matching snapshot rule's path limits.
- Before provider start, compare the project, run, session, role, provider, risk, request digest, suites, and all expected paths with the command and current project-bound policy store. Reverify snapshot, approval, and revocation schemas, purpose signatures, and times. Failure returns `approval_required` before adapter start.
- Only passing `require_approval` runs start `managed_write`.
- Immediately before each provider write, rerun the same verifier for the current time and path. Snapshot change, expiry, or revocation records `capability.decided=require_approval` and denies the write.
- The existing gate independently verifies E3, expected path, and the before-hash. Only when both checks pass does it issue a one-use permit bound to the approval and snapshot IDs. Record the actual approval ID and `policyRuleId=managed_context_e3+signed_approval`, then invalidate the permit with its context after the change.
- The orchestrator depends only on `ManagedCapabilityApprovalVerifier`; policy and SQLite remain behind ports. Adapters consume only the bridge's allow or deny result.
- Local `allow` and `deny` require no authorization and remain Hub-independent. Direct, unobservable work remains `unmanaged`.

Authorization and permits exist only in memory. Events retain only the approval ID, not envelopes, subject hashes, or signatures.

Missing, mismatched, expired, revoked, replaced, or invalid sources produce `approval_required`. A pre-write denial emits no permit. Verification or storage exceptions never become `allow` and close the run as `provider_write_failed`.

Signed SQLite and coordinator fixtures cover path scope, revocation, preflight and pre-write rechecks, telemetry with one verified change, denial before provider mutation, and unchanged local and provider contract suites.

## Consequences

`require_approval` opens exactly one managed write only when current command-bound approval and E3, path, and file proof all pass. ADR-0045 adds Hub authoring and transport; policy UI remains future work.
