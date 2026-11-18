# ADR-0228: Organization Deployment Policy and Runtime Credentials

Status: superseded
Date: 2026-08-27

Superseded by [ADR-0560](../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md). Lervo no longer ships this capability.

## Context

Repository Node identity, owner-only bearer files, and atomic Hub and Node reload protect one installed runtime but do not define organization tenancy, credential issuance or delivery authority, bounded rotation, or retained delivery evidence. Treating the bearer file as organization policy would combine secret possession, deployment authority, and project scope.

Local execution must continue without a Hub. Organization coordination must remain provider-, network-, and secret-manager-neutral. Tracked manifests and ordinary receipts must not contain secret material.

## Decision

Add `@lervo/organization-deployment-contract` and schema-derived v1 records for organization policy and runtime credential delivery.

An `OrganizationDeploymentPolicy` is content-addressed, sequence-bound, time-bounded, and admitted through a purpose-specific Ed25519 signature. It uses `strict_project` tenancy: every project binds both project ID and repository identity hash. Every authority names a principal, explicit project IDs, and explicit deployment permissions; missing authority denies the operation. Each project must have different principals capable of credential issuance and delivery.

The policy fixes `runtime_only` credential delivery, issuer/deliverer separation, maximum lifetime, maximum rotation overlap, and the exact runtime permissions it may grant. V1 grants may authorize Node-facing read and coordination permissions, but not policy writes, command authoring, approval writes, or capability publication.

An `OrganizationRuntimeCredentialGrant` contains no bearer value, secret reference, file path, or provider configuration. It binds the organization policy ID and hash, project identity, Node, destination, subject principal, permissions, generation, prior credential ID, issuer, validity interval, and `material: runtime_only`. First issuance requires `credential.issue`. Later generations require `credential.rotate`, the same target, consecutive generation, and gap-free overlap no larger than the policy permits.

An `OrganizationRuntimeCredentialRevocation` binds the policy, grant, revoking principal, time, and one bounded reason. Before reading material, delivery revalidates the signed-policy-derived contract, project authority, active interval, revocations, and distinct delivery principal.

The runtime delivery port asks an injected source for bytes by credential ID and passes them directly to an injected consumer. Bearer bytes must be 32–4096 visible ASCII bytes. The source buffer is cleared after confirmed activation or failure. A consumer may retain the credential only in runtime memory according to its reload contract. Source and consumer errors become fixed failure messages that do not echo causes or secret bytes.

Successful activation returns an `OrganizationRuntimeCredentialDeliveryReceipt` containing the policy, credential, project, Node, destination, generation, delivering principal, time, and `secretMaterial: excluded`. The receipt proves only that the consumer returned activation success. It does not prove Hub authentication, synchronization, fleet readiness, later use, or revocation propagation.

## State, Privacy, and Failure Meaning

| Record | Required coordinates | Owner and privacy |
| --- | --- | --- |
| `OrganizationDeploymentPolicy` | Organization, sequence, previous policy, interval, projects, authorities, credential bounds | Organization authority; signed and content-addressed; contains no secrets |
| `OrganizationRuntimeCredentialGrant` | Policy ID/hash, project identity, Node, destination, subject, permissions, generation, interval | Credential authority; mutable runtime control state; contains no material or source location |
| `OrganizationRuntimeCredentialRevocation` | Policy ID/hash, credential, principal, time, reason | Credential authority; secret-free lifecycle state |
| `OrganizationRuntimeCredentialDeliveryReceipt` | Policy, credential, target, generation, principal, time | Local runtime evidence; secret material is always `excluded` |

This decision adds no Lervo event. Future persistence or Hub APIs must define their own event name, allowlisted fields, retention, and recovery contract before durably writing these records.

Failures are bounded and fail closed:

- `invalid_organization_policy` and `invalid_organization_policy_signature`: policy structure, content identity, continuity, authority separation, or signature was not established.
- `organization_authority_denied`: the principal, project, permission, time, or issuer/deliverer separation did not authorize the operation.
- `invalid_credential_grant` and `invalid_credential_revocation`: identity, scope, generation, interval, rotation, or policy binding was not established.
- `credential_not_active` and `credential_revoked`: delivery was refused before secret material was read.
- `credential_source_failed`, `credential_material_invalid`, and `credential_activation_failed`: no activation receipt was created. These failures do not establish whether an external source or consumer had an effect beyond the observed boundary.

## Consequences

Organization policy and credential lifecycle are testable without choosing Vault, KMS, an identity provider, a network, or a Hub deployment. Existing local bearer files remain supported, and local execution remains unchanged. [ADR-0230](0230-owner-only-file-organization-credential-source.md) adds a concrete owner-only file bootstrap source without treating it as an external organization authority. [ADR-0231](0231-authenticated-node-organization-credential-activation.md) composes that source into an explicitly configured Node and activates only after authenticated project registration.

This decision does not persist organization policy, implement a secret-source adapter, propagate revocations, or perform rollout effects. [ADR-0229](0229-organization-node-enrollment-and-gradual-rollout.md) adds secret-free enrollment evidence and gradual rollout authorization while leaving local mutation, persistence, transport, and installed organization acceptance separate.

## Verification

Contract tests cover canonical IDs, strict project scope, split authority, purpose-specific signatures, permission and lifetime bounds, consecutive rotation and overlap, revocation-before-load, secret-free receipts, and source-buffer clearing after both success and activation failure. Schema type tests keep runtime-only material and excluded delivery evidence distinct.

## References

- [Hub and Node coordination](../../../specifications/coordination/hub-and-node.md)
- [Atomic Hub bearer-credential reload](../../../decisions/coordination/remote-control/0159-atomic-hub-bearer-credential-reload.md)
- [Atomic Node bearer-token reload](0161-atomic-node-bearer-token-reload.md)
- [Repository Node fleet identity](../services/0202-repository-node-fleet-identity-and-registry.md)
- [Organization Node enrollment and gradual rollout](0229-organization-node-enrollment-and-gradual-rollout.md)
- [Owner-only file organization credential source](0230-owner-only-file-organization-credential-source.md)
- [Authenticated Node organization credential activation](0231-authenticated-node-organization-credential-activation.md)
