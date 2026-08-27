# ADR-0231: Authenticated Node Organization Credential Activation

Status: accepted
Date: 2026-08-27

## Context

The organization delivery contract and owner-only file source can validate authority and load one exact credential, but the installed Node had no organization-aware consumer. Its ordinary bearer reload validates bytes and swaps memory without contacting the Hub, so a successful reload cannot support an activation receipt.

The running Node must continue serving with its current token while checking a candidate. Organization delivery also needs a local identity anchor so a valid grant for another Node, repository identity, or destination cannot select this process's bearer file.

## Decision

Add optional `organizationCredentials.nodeId` configuration to the Node runtime. When present, `openNodeRuntime` composes the existing owner-only bearer-token file as the exact credential source and binds delivery to that Node ID, the loaded project ID and identity hash, and the configured Hub destination. A mismatched grant is rejected before source material is read.

`NodeRuntimeDeployment.deliverOrganizationCredential` accepts one policy, grant, bounded revocation set, delivering principal, and delivery time. The existing organization contract revalidates policy scope, authority, time, revocation, and material before invoking the installed consumer. Delivery is unavailable when the identity anchor is absent, shutdown has begun, another delivery is active, or an ordinary token or material reload is active. Credential-changing operations do not run concurrently.

The consumer decodes the validated visible-ASCII candidate into runtime memory, creates a transport that snapshots only that candidate, and performs the existing authenticated project-registration exchange. The sync registration boundary verifies the configured Hub destination and peer identity and validates that the response matches the exact project registration. Only after that exchange succeeds does the consumer synchronously replace `ReloadableNodeBearerToken`. Later requests obtain the new snapshot. Failure preserves the prior in-memory token and creates no delivery receipt.

For this installed consumer, an organization delivery receipt proves that the candidate completed the authenticated project-registration exchange before the memory swap. It does not prove every granted permission, event synchronization, workstream replication, remote-command access, fleet readiness, later use, or revocation propagation. Provider-injected transports remain responsible for satisfying the authenticated transport contract.

This operation does not write the bearer file, persist the policy, grant, revocation, or receipt, emit an event, or expose a process signal, CLI command, Hub endpoint, or rollout action. The file is an external input: if replaced before a failed activation, the running process retains its old token, but restart recovery and restoration of prior file bytes remain outside this boundary.

## Failure and Privacy

`organization_credential_delivery_failed` means the local Node binding was absent or mismatched, shutdown or another credential mutation prevented an exclusive attempt, or another organization delivery was already active. It contains no token, path, Hub coordinate, grant body, or native cause. Domain source, material, authority, revocation, and activation failures retain the bounded meanings from ADR-0228. Candidate authentication failure becomes `credential_activation_failed`; it creates no receipt and does not reveal whether the Hub rejected credentials or the authenticated exchange otherwise failed.

No new event or durable state is added. The receipt remains secret-free with `secretMaterial: excluded`. The configured source path remains only in the existing owner-only Node configuration and is not copied into organization records or documentation.

## Consequences

The installed Node application gains an executable, provider-neutral organization credential activation boundary. Local-only and ordinary non-organization Node operation remain unchanged when `organizationCredentials` is absent. A candidate cannot displace the current running token merely because its file bytes are valid.

Exact local plan/apply integration, durable recovery of externally replaced files, installed process delivery transport, bounded receipt persistence, and fleet rollout execution remain separate work. External secret authorities can replace the source port without changing the activation rule.

## Verification

Focused tests cover strict organization Node configuration, opened-runtime composition through an authenticated registration response, retention of the current token during candidate verification, replacement only after success, secret-free evidence, failure rollback, and rejection of another Node before material access. Type, package-boundary, Node distribution, and full-repository checks cover the bundled runtime.

## References

- [Organization deployment policy and runtime credentials](0228-organization-deployment-policy-and-runtime-credentials.md)
- [Owner-only file organization credential source](0230-owner-only-file-organization-credential-source.md)
- [Atomic Node bearer-token reload](0161-atomic-node-bearer-token-reload.md)
- [Hub and Node coordination](../../../specifications/coordination/hub-and-node.md)
