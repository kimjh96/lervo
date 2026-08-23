# ADR-0044: Bind signed approval source to managed-write permits

Status: `accepted`
Decision date: 2026-08-19

## Context

Remote policy validated command-bound approval but passed only IDs to executors, while coordinator always blocked `require_approval`. A boolean bridge could miss expiry, revocation, snapshot replacement, or path mismatch after run start. Local allow must still work without Hub, and provider-specific approval mechanisms cannot decide final authority.

## Decision

- `ManagedRunApprovalAuthorization` carries verified command source, signer key ID, policy snapshot ID, and approval ID—never request, credential, approver identity, or reason. It is revalidation input, not authority by itself.
- `PolicyApproval` binds 1–16 normalized relative paths; it cannot widen a matching snapshot rule's path limits.
- Before provider start, compare project/run/session/role/provider/risk/request digest/suites/all expected paths with the command and current project-bound policy store. Reverify snapshot/approval/revocation schemas, purpose signatures, and times. Failure returns `approval_required` before adapter start.
- Only passing `require_approval` runs start `managed_write`.
- Immediately before each provider write, re-run the same verifier for current time/path. Snapshot change, expiry, or revocation records `capability.decided=require_approval` and denies.
- Existing gate independently verifies E3, expected path, and before-hash. Only both checks issue a one-use permit bound to approval and snapshot IDs. Record actual approval ID and `policyRuleId=managed_context_e3+signed_approval`; invalidate permit with context after change.
- Orchestrator depends only on `ManagedCapabilityApprovalVerifier`; policy and SQLite remain behind ports. Adapters consume bridge allow/deny only.
- Local `allow`/`deny` take no authorization and remain Hub-independent. Direct unobservable work remains `unmanaged`.

Authorization/permit are in-memory. Events retain approval ID only, not envelopes, subject hash, or signature. Missing/mismatched/expired/revoked/replaced/invalid sources are `approval_required`; a pre-write denial emits no permit. Verification/storage exceptions never become allow and close the run as `provider_write_failed`.

Signed SQLite and coordinator fixtures cover path scope, revocation, preflight plus pre-write recheck, telemetry/one verified change, denial before provider mutation, and unchanged local/provider contract suites.

## Consequences

`require_approval` opens exactly one managed write only with current command-bound approval plus E3/path/file proof. ADR-0045 adds Hub authoring/transport; policy UI remains later work.
