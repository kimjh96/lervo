# Organization deployment policy and runtime credentials

Status: `complete`
As of: 2026-08-27
Completed: 2026-08-27

[ADR-0560](../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md) removed the organization deployment policy, runtime credential grants, and the `@lervo/organization-deployment-contract` and `@lervo/organization-deployment-sqlite` packages. `lervo upgrade` owns the Node stage. The records below are history.

## Problem

Repository-scoped Node deployment had deterministic identity, owner-only local configuration, atomic bearer reload, and transactional readiness. It lacked organization tenancy, deployment authority, separate credential issuance and delivery, bounded rotation, and secret-free delivery evidence.

## Product outcome

An organization can admit a signed, content-bound deployment policy naming exact repository identities and explicit principals. Runtime credentials are short-lived, least-privilege grants whose material is obtained only during activation. Issuance, delivery, rotation, and revocation are separate permissions. Tracked manifests and delivery receipts contain neither secrets nor their source locations.

Local execution remains available without an organization policy, Hub, or external credential source. A later owner-only file adapter supplies a concrete local bootstrap source without changing that guarantee.

## Completed scope

1. Added schema-derived contracts for organization policies, signed envelopes, credential grants, revocations, and delivery receipts.
2. Required strict project tenancy using project ID and repository identity hash.
3. Required distinct credential issuer and runtime delivery principals for every project.
4. Bound policy continuity, expiry, credential TTL, allowed permissions, generation, prior credential, and maximum rotation overlap.
5. Added purpose-specific Ed25519 policy signing and verification.
6. Added runtime source and consumer ports that never expose credential material through policy or receipt records.
7. Cleared source credential bytes after activation success or failure and returned only `secretMaterial: excluded` evidence.
8. Rejected invalid authority, inactive credentials, and effective revocations before loading material.

## Acceptance

- A valid signed policy verifies only with its intended key and exact policy bytes.
- A principal cannot operate outside its explicit project or permission scope.
- A grant's issuer cannot deliver that grant.
- Rotation preserves target identity and consecutive generation without gaps or excess overlap.
- Revoked or inactive credentials are rejected before the source is read.
- Successful delivery produces a content-addressed, secret-free receipt; failed delivery produces no receipt.
- Source material is cleared on every post-load exit.
- Organization contracts neither change local-only execution nor write tracked secrets.

## Follow-up scope

- The owner-only file bootstrap adapter is implemented in the [runtime credential source roadmap](organization-runtime-credential-sources.md); installed Node composition remains pending.
- Concrete Vault, KMS, operating-system keychain, or workload-identity adapters after an organization selects its authority.
- Durable organization-policy, grant, revocation, and receipt storage and related events.
- Installed organization rollout execution, durable coordination, and unattended cross-version automation.
- External publication credentials and approvals.

The organization Node enrollment and gradual rollout contract is complete in [its follow-up roadmap](organization-node-fleet-rollout.md).

## References

- [ADR-0228](../../decisions/operations/security/0228-organization-deployment-policy-and-runtime-credentials.md)
- [Hub and Node coordination](../../specifications/coordination/hub-and-node.md)
- [Repository Node fleet](../coordination/repository-node-fleet.md)
- [Organization Node fleet rollout](organization-node-fleet-rollout.md)
- [Organization runtime credential sources](organization-runtime-credential-sources.md)
