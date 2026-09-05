# Hub and node runtimes

## Authentication and credentials

Hub endpoints authenticate before access. Signed organization policies enforce project scopes and separate credential issuance from delivery. Secret-free grants bind their Node, destination, permissions, generation, and lifetime; runtime sources provide bearer bytes.

The owner-only file source performs bounded no-follow reads, clears raw buffers, and activates a candidate only after authenticated project registration. It is not an external secret authority.

## Rollout and rollback

Approved rollout execution and rollback are exact one-Node transactions. Forward delivery authenticates, fences replay, and records a recovery baseline. Recovery classifies without applying. Rollback binds the failed artifact to the enrolled predecessor and commits the registry after readiness; it lacks authenticated process delivery. None is Hub, daemon, or multi-Node transport.

Installed Nodes use deterministic project, repository, and Node identity. An owner-only local registry binds root, destination, runtime, service, and health coordinates without credentials. Exact apply transactionally installs or upgrades, requires three stable complete observations, then registers. Organization enrollment binds that evidence to active credential delivery.

Rollout begins with one canary, grows at most twofold, and separates planning, observation, approval, execution, and rollback. Plans and approvals claim no effect; a Node execution receipt claims only its exact local transaction.

## Workstream and event replication

Bounded workstream revisions replicate separately from event streams, keyed by project and repository identity. Authorized nodes see the same append-only head set. Each event-producing node uses a distinct destination coordinate because each destination owns one canonical hash chain.

A node publishes local ancestry, imports only a newer unique head through CAS, projection, and a system event, and exposes divergence without choosing a winner. Pending approvals transfer only as unresolved state, never authority.

Local event producers do not know Hub endpoints or device credentials. When policy permits and a Node selects a destination, it authenticates registration, checks the Hub cursor against local truth, and durably reconciles the next bounded event prefix into that destination's outbox.

## Reader compatibility

Event-reader compatibility is a provider-neutral, rebuildable capability observation, not writer authority. Local diagnostics and Node health advertise their readable envelope versions. Hub exposes the same secret-free report through an identity-bound health endpoint that sync clients read without sending bearer credentials.

Missing or incapable peers cannot authorize v2 writing. Local execution and v1 writing remain independent of Hub availability.

For a Hub-enabled project, the existing owner-only Node fleet registry is the complete configured membership authority. The service definition and runtime config bind its Node and Hub observation sources. Planning and apply each re-observe exact capability and identity without creating another reader registry.

## Optional coordination and capability registry

Optional Hub coordination reserves path digests before local leases. Summaries are observational; the Hub cannot write, integrate, approve, or clean. See [Hub and Node coordination](../../specifications/coordination/hub-and-node.md).

The optional Hub capability registry accepts only explicit content-bound publication. Project packages require matching project scope; public packages require explicit public selection. Separate read and publish permissions protect immutable envelopes. Local packages and execution do not depend on this registry.

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
