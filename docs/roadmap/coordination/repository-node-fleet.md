# Repository Node fleet and automatic Hub replication

Status: `complete`
As of: 2026-08-25
Completed: 2026-08-25

## Problem and outcome

Workstream replication was automatic within an authorized running Node, but installed services did not cover every initialized repository. The global macOS `com.lervo.node` service served only Shiflo, crash-looped with exit code 1, and reported `local_batch_invalid` for event sync and workstream replication. A second inspected repository had no deployed Node. Contract and runtime tests established implementation, not installed fleet health.

Every Hub-enabled repository must have one durable repository-node registration and one independently addressable runtime. Lervo automatically reconciles initialization, migration, upgrade, relocation, and health recovery. Workstream revisions publish and unique newer Hub heads import without user commands. Ordinary onboarding requires no manual installation, start, repair, or replication trigger. Local execution remains available when the Hub is unavailable.

Identity derives from the project manifest and identity hash, never the checkout folder name. Repositories on one device run concurrently without sharing service labels, configuration, event destinations, credentials, health, or repair state.

## Details

- [Fleet requirements, completed implementation, and acceptance](repository-node-fleet/fleet.md)
- [Idle runtime and change-driven scheduling follow-up](repository-node-fleet/idle-runtime.md)

## Contracts and evidence

- [ADR-0202: Fleet identity and registry](../../decisions/operations/services/0202-repository-node-fleet-identity-and-registry.md)
- [ADR-0203: Read-only onboarding reconciliation](../../decisions/operations/services/0203-read-only-repository-node-onboarding-reconciliation.md)
- [ADR-0201: Accepted replication contract](../../decisions/coordination/sync/0201-repository-scoped-workstream-replication.md)
- [ADR-0397: Idle reconciliation](../../decisions/coordination/sync/0397-event-driven-node-idle-reconciliation.md)
- [Idle reconciliation specification](../../specifications/coordination/node-idle-reconciliation.md)
- [Idle reconciliation evidence](../../evidence/foundation/node-idle-reconciliation-v1.md)
- [ADR-0399: Change-driven repository and conversation work](../../decisions/coordination/sync/0399-change-driven-repository-and-conversation-work.md)
- [Change-driven work specification](../../specifications/coordination/node-change-driven-work.md)
