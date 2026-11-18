# Product-host protocol

Status: `active`
As of: 2026-09-17

Separately installed operating and collaboration products compose Lervo locally through installed `@lervo/cli`, without a Hub, workspace-private imports, or storage-internal access.

## Discovery

Default discovery returns the 21-route `ProductHostCapabilityReportV1`:

```bash
lervo application capabilities --json
```

Explicit protocol versions add capabilities without changing earlier versions:

- v2: read-only operating-attention and operating-goal routes and projections.
- v3: read-only operating-liveness route and projection.
- v4: reviewed direct-message triggering, explicit handoff acknowledgment, and its projection.
- v5: bounded unattended assignment execution, removed only from v5's unsupported list.
- v6: graph-v2 inspection and reviewed bounded topology changes, removed only from v6's unsupported list.
- v7: agent context, multi-team operating projection, team reclassification, bounded CEO decision, and exact organization-executive effect routes.
- v8: source-bound, privacy-bounded product activity projection from the verified canonical event chain.
- v9: revision-stable repository-knowledge product search through the qualified Lexical v2 adapter.
- v10: source-bound managed-work observability over canonical execution evidence.
- v11: source-bound installed deliberation projection over queue, event, artifact, verification, organization, resource, publication, and delivery evidence.

[ADR-0560](../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md) removed the `assignment mention`, `assignment trigger`, `assignment connector`, `assignment topology`, and `routine materialize` commands. The frozen route descriptors that name them no longer resolve to a command, and ADR-0560 removes this protocol in a later batch.

```bash
lervo application capabilities --protocol 2 --json
lervo application capabilities --protocol 3 --json
lervo application capabilities --protocol 4 --json
lervo application capabilities --protocol 5 --json
lervo application capabilities --protocol 6 --json
lervo application capabilities --protocol 7 --json
lervo application capabilities --protocol 8 --json
lervo application capabilities --protocol 9 --json
lervo application capabilities --protocol 10 --json
lervo application capabilities --protocol 11 --json
```

Versions are compatibility and discovery contracts. They do not grant authority, identify repository snapshots, or assert that route prerequisites are satisfied.

Future versions add Lervo-owned reference-product capabilities defined by the [product-surface specification](product-surfaces.md). Additions remain explicit and capability-negotiated; existing versions retain their route and evidence meanings. Discord and the future first-party surface must pass the same host-neutral conformance cases even when rendering differs.

## Specification

- [Report contract, authority, and unsupported capabilities](product-host-protocol/contract.md)
- [Route inventory and version-specific requirements](product-host-protocol/routes.md)
- [External-consumer acceptance](product-host-protocol/acceptance.md)

## References

- [Bounded unattended assignment scheduling](unattended-scheduling.md)
- [Bounded dynamic assignment topology](dynamic-assignment-topology.md)
- [ADR-0355](../../decisions/execution/applications/0355-expose-versioned-packed-product-host-protocol.md)
- [ADR-0361](../../decisions/execution/applications/0361-project-operating-attention-without-new-authority.md)
- [ADR-0374](../../decisions/execution/applications/0374-project-operating-liveness-without-health-inference.md)
- [ADR-0375](../../decisions/execution/orchestration/governed-work/0375-route-reviewed-direct-messages-and-record-explicit-handoff-acknowledgment.md)
- [ADR-0379](../../decisions/execution/orchestration/governed-work/0379-install-bounded-unattended-assignment-scheduling.md)
- [ADR-0380](../../decisions/execution/orchestration/governed-work/0380-install-bounded-dynamic-assignment-topology.md)
- [ADR-0390](../../decisions/coordination/conversations/0390-project-reviewed-agent-context-and-headless-organization-control.md)
- [ADR-0393](../../decisions/coordination/conversations/0393-named-agent-identity-and-installed-organization-effects.md)
- [Operating attention](operating-attention.md)
- [Operating liveness](operating-liveness.md)
- [Operating goals](operating-goals.md)
- [Governed loop roadmap](../../roadmap/governed-loop-assignment-graph.md)
- [Assignment interactions](assignment-interactions.md)
- [Product surfaces](product-surfaces.md)
- [ADR-0417](../../decisions/execution/applications/0417-own-discord-visible-reference-product.md)
- [ADR-0418](../../decisions/execution/applications/0418-retain-deliberation-as-bounded-decision-workflow.md)
