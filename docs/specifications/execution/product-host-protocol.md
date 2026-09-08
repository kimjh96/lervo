# Product-host protocol

Status: `active`
As of: 2026-09-09

Separately installed operating or collaboration products discover and compose Lervo locally through installed `@lervo/cli`, without a Hub, workspace-private imports, or storage-internal access.

## Discovery

Default discovery returns the 21-route `ProductHostCapabilityReportV1`:

```bash
lervo application capabilities --json
```

Explicit versions add capabilities without changing earlier versions' discovery:

- v2: read-only operating-attention and operating-goal routes and projections.
- v3: read-only operating-liveness route and projection.
- v4: reviewed direct-message triggering, explicit handoff acknowledgment, and its projection.
- v5: bounded unattended assignment execution, removed from only v5's unsupported list.
- v6: graph-v2 inspection and reviewed bounded topology changes, removed from only v6's unsupported list.
- v7: agent context, multi-team operating projection, and bounded CEO decision routes.

```bash
lervo application capabilities --protocol 2 --json
lervo application capabilities --protocol 3 --json
lervo application capabilities --protocol 4 --json
lervo application capabilities --protocol 5 --json
lervo application capabilities --protocol 6 --json
lervo application capabilities --protocol 7 --json
```

Versions are compatibility and discovery contracts, not authority grants, repository snapshots, or assertions that route prerequisites are satisfied.

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
- [Operating attention](operating-attention.md)
- [Operating liveness](operating-liveness.md)
- [Operating goals](operating-goals.md)
- [Governed loop roadmap](../../roadmap/governed-loop-assignment-graph.md)
- [Assignment interactions](assignment-interactions.md)
- [Reviewed direct-message triggers and handoff acknowledgment](assignment-message-triggers.md)
- [Assignment routines](assignment-routines.md)
- [Assignment connectors](assignment-connectors.md)
