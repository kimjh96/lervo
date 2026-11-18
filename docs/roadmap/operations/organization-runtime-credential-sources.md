# Organization Runtime Credential Sources

Status: `historical`
As of: 2026-08-27

[ADR-0560](../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md) removed the owner-only file credential source, the Node `organizationCredentials` activation path, and the `@lervo/organization-credential-source-file` package. `lervo upgrade` owns the Node stage. The records below are history.

## Problem

Organization policy and delivery contracts were provider-neutral but had no concrete source for runtime credential bytes. No external secret authority is registered for this repository, while installed Nodes already rely on an owner-only bearer-file boundary.

## Product outcome

Lervo can obtain one exact organization credential from a bounded owner-only local file without exposing its path or material in organization records. The source remains replaceable by an explicitly authorized Vault, workload-identity, KMS, or keychain adapter. Source access alone never claims activation, authentication, or rollout.

## Completed scope

1. Added the private `@lervo/organization-credential-source-file` package behind `RuntimeCredentialSource`.
2. Bound one immutable runtime snapshot of at most 256 exact credential IDs to local paths.
3. Reused the shared no-follow, owner-only, bounded, change-detecting file read.
4. Removed at most one final LF or CRLF without decoding secret material.
5. Cleared the raw read buffer before returning and relied on the organization delivery contract to clear the returned buffer after activation.
6. Kept paths and material out of grants, revocations, receipts, events, and source documentation.
7. Returned fixed adapter failures and preserved the existing organization `credential_source_failed` translation.
8. Composed the source in `openNodeRuntime` behind an explicit organization Node identity.
9. Verified a candidate through the existing authenticated project-registration exchange before atomically replacing the running token.
10. Preserved the prior in-memory token and omitted the receipt on activation failure or binding mismatch.
11. Bound one approved `execute_wave` Node to the exact current local plan and existing transactional apply receipt.
12. Added authenticated owner-only process delivery and durable target-bound replay receipt persistence for that one-Node transaction.
13. Added bounded uncertain-effect classification without replaying an unresolved forward apply.
14. Added an exact predecessor-bound installed rollback transaction behind a separate programmatic port.
15. Verified a three-Node installed composition through canary advancement, twofold expansion, hold, and failed-Node-only rollback.
16. Added authenticated installed rollback delivery, a distinct durable replay fence, and bounded uncertain-effect inspection without replay.

## Current acceptance

- A bound owner-only file delivers its exact visible-ASCII material through the organization contract.
- A missing binding, duplicate identity, unsafe permission, symbolic link, oversized file, or read race fails closed.
- Successful delivery produces only a secret-free receipt and clears the delivered byte array.
- The adapter neither selects organization authority nor writes, rotates, activates, reloads, authenticates, or deploys anything.
- The installed consumer rejects another Node, project identity, or destination before reading material and serializes credential mutations.
- A successful installed delivery proves candidate project registration before memory activation, but not broader permissions, synchronization, readiness, later use, or rollout.
- A trusted signed rollout delivery invokes its exact local transaction at most once; unresolved effects remain fenced and do not claim recovery.
- Three installed Node compositions preserve canonical wave gating and isolate rollback effect to the exact degraded Node; this is not cross-Node atomicity or unattended automation.
- Signed rollback delivery reuses scoped trust while keeping rollback effects and durable replay coordinates separate from forward execution.

## Remaining scope

1. Select and authorize an external secret authority only when the organization provides one, then implement its adapter against the same contract tests.
2. Define bounded persistence and events before storing grants, revocations, observations, approvals, or recovery status outside the local replay receipt boundary.
3. Define an explicit controller and operating policy before any unattended fleet-wide rollback or cross-Node automation.

## References

- [ADR-0230](../../decisions/operations/security/0230-owner-only-file-organization-credential-source.md)
- [ADR-0231](../../decisions/operations/security/0231-authenticated-node-organization-credential-activation.md)
- [ADR-0232](../../decisions/operations/security/0232-approved-node-rollout-local-transaction.md)
- [ADR-0233](../../decisions/operations/security/0233-authenticated-node-rollout-process-delivery.md)
- [ADR-0234](../../decisions/operations/security/0234-bounded-node-rollout-effect-recovery.md)
- [ADR-0235](../../decisions/operations/security/0235-predecessor-bound-node-rollout-rollback.md)
- [ADR-0236](../../decisions/operations/security/0236-authenticated-node-rollback-process-delivery.md)
- [Installed multi-device acceptance](../../evidence/operations/organization-node-multi-device-rollout-v1.md)
- [Organization deployment policy](organization-deployment-policy.md)
- [Organization Node fleet rollout](organization-node-fleet-rollout.md)
