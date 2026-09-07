# Hub and node runtimes

- [Authentication and credentials](hub-and-nodes/authentication.md)
- [Rollout and rollback](hub-and-nodes/rollout.md)
- [Workstream and event replication](hub-and-nodes/replication.md)
- [Reader compatibility](hub-and-nodes/reader-compatibility.md)
- [Optional coordination and capability registry](hub-and-nodes/optional-coordination.md)

Coordination contract: [Hub and Node coordination](../../specifications/coordination/hub-and-node.md).

## Decisions

- [Signed commands](../../decisions/coordination/remote-control/0041-signed-scoped-remote-command.md)
- [Hub runtime](../../decisions/coordination/remote-control/0149-owner-only-loopback-hub-runtime.md)
- [Destination reconciliation](../../decisions/coordination/sync/0194-destination-bound-local-event-reconciliation.md)
- [Node control](../../decisions/coordination/remote-control/0152-fail-closed-node-remote-control-runtime.md)
- [Direct TLS](../../decisions/coordination/remote-control/0158-direct-tls-hub-runtime.md)
- [Workstream replication](../../decisions/coordination/sync/0201-repository-scoped-workstream-replication.md)
- [Fleet identity](../../decisions/operations/services/0202-repository-node-fleet-identity-and-registry.md)
- [Distributed reader inventory](../../decisions/operations/trace/0332-authoritative-distributed-event-reader-inventory.md)
- [Apply](../../decisions/operations/services/0207-transactional-repository-node-apply-and-readiness.md)
- [Organization rollout](../../decisions/operations/security/0229-organization-node-enrollment-and-gradual-rollout.md)
- [Owner-only credential source](../../decisions/operations/security/0230-owner-only-file-organization-credential-source.md)
- [Authenticated Node credential activation](../../decisions/operations/security/0231-authenticated-node-organization-credential-activation.md)
- [Approved Node rollout transaction](../../decisions/operations/security/0232-approved-node-rollout-local-transaction.md)
- [Authenticated rollout delivery](../../decisions/operations/security/0233-authenticated-node-rollout-process-delivery.md)
- [Bounded rollout recovery](../../decisions/operations/security/0234-bounded-node-rollout-effect-recovery.md)
- [Predecessor-bound rollback](../../decisions/operations/security/0235-predecessor-bound-node-rollout-rollback.md)
- [Upgrade](../../decisions/operations/services/0214-bounded-repository-upgrade-orchestration.md)
