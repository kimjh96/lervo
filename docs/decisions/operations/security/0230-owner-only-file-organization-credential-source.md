# ADR-0230: Owner-Only File Organization Credential Source

Status: accepted
Date: 2026-08-27

## Context

The organization deployment contract accepts runtime credentials only through an injected, provider-neutral source. The repository has no registered Vault, cloud workload-identity, KMS, or operating-system keychain authority. Installed Nodes already use an owner-only bearer file with bounded, no-follow reads and atomic reload.

A concrete source is needed to exercise organization delivery without selecting an unavailable external authority, storing secret locations in grants, or coupling the domain contract to the filesystem.

## Decision

Add the private `@lervo/organization-credential-source-file` adapter. One immutable runtime snapshot binds between one and 256 exact `ocg_` credential IDs to local file paths. The adapter resolves paths when constructing the snapshot but never adds them to organization policies, grants, revocations, delivery receipts, events, or repository documentation.

Loading requires an exact credential-ID binding. The adapter uses the shared owner-only file boundary: it opens without following symbolic links; requires a regular, non-empty file; enforces the existing owner-only permission rule and a 4,098-byte read limit; and detects changes during the read. It removes at most one final LF or CRLF byte sequence without decoding the secret. It clears the raw file buffer before returning a fresh byte array. The organization delivery contract independently validates 32–4,096 visible ASCII bytes and clears the returned array after activation succeeds or fails.

Adapter configuration and material failures use fixed messages. `invalid_source_config` means the binding count, credential ID, duplicate identity, or path bound was invalid. `credential_material_unavailable` means no exact binding existed or the file could not be read safely. The organization delivery boundary translates source failures to its existing `credential_source_failed` meaning and creates no receipt.

This source is a local bootstrap adapter, not an organization secret authority. It does not issue grants, choose delivery principals, write or rotate files, retain material, activate a Node token, reload a process, authenticate to a Hub, or authorize rollout. It adds no event or durable adapter store. ADR-0231 composes it with the installed Node while keeping those responsibilities outside the adapter. An external source remains separate work.

## Consequences

Organization credential delivery gains a concrete, provider-neutral filesystem adapter that reuses the deployed Node security boundary. Tests can exercise real owner-only permissions and secret-free receipts without a Vault or cloud dependency. Local execution still works without organization policy or Hub connectivity.

The runtime-private binding snapshot must be supplied by an authorized composition root. Changing a file or binding proves no rotation, delivery, activation, or later use. External Vault, workload-identity, KMS, or keychain integration requires a separate adapter and authority decision.

## Verification

Focused tests cover a real owner-only file with one trailing newline, exact delivery through the organization contract, clearing the delivered byte array, exclusion of path and material from the receipt, an unbound credential, duplicate bindings, unsafe permissions, and symbolic-link rejection. Type, architecture, package-boundary, and full-repository checks cover integration.

## References

- [Organization deployment policy and runtime credentials](0228-organization-deployment-policy-and-runtime-credentials.md)
- [Organization Node enrollment and gradual rollout](0229-organization-node-enrollment-and-gradual-rollout.md)
- [Atomic Node bearer-token reload](0161-atomic-node-bearer-token-reload.md)
- [Authenticated Node organization credential activation](0231-authenticated-node-organization-credential-activation.md)
- [Hub and Node coordination](../../../specifications/coordination/hub-and-node.md)
