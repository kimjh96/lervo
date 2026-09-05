# Project and storage

## Storage authority

`.lervo/project.yaml` identifies the repository and privacy defaults. Durable records reside in gitignored `.lervo/data`; rebuildable projections reside in `.lervo/state`. Runtime directories are created lazily. Legacy relocation is atomic and fails closed on conflicting copies.

The optional `.lervo/data/event-contract.json` is the versioned, Lervo-managed future-write coordinate. Absence selects event schema version 1. `@lervo/project` validates and recovers it before project storage injects the selection into the event-store adapter. Indexes, graphs, and projections cannot change writer authority.

Active continuation is `.lervo/state/workstreams/current.json`. CAS in `.lervo/data/cas` stores exact snapshots and optional legacy-source bytes. `workstream.snapshot.recorded` binds revision and content coordinates without event prose. Migration discovers candidates from bounded content structure, without requiring names or locations. Before returning context, Lervo rebuilds a missing projection from the latest event and CAS bytes. Canonical Markdown retains long-term facts.

## Workforce and workspaces

Owner-only workforce and workspace coordination state resides under the Git common directory so sibling worktrees share one scheduler. Non-Git checkouts use a standalone compatibility home. Legacy migration rejects competing non-empty authorities.

Versioned role contracts, ancestry hashes, bounded delegation, atomic path leases, and exact handoff evidence govern root agents and subagents. Workspace lifecycle is local; Orca and Hub are optional. Apply rechecks authority, and uncertainty requires recovery. See the [workspace specification](../../specifications/execution/agent-workspaces.md).

## Capability packages

Local capability packages are lazy, immutable project- or user-scoped directories. A provider-neutral resolver validates hashes, compatibility, role permissions, exact dependency graphs, discovery metadata, MCP runtime descriptors, and native plugin manifests, then writes a rebuildable lock.

Telemetry distinguishes recommendation, selection, verified loading, provider activation, skill invocation, and completion. Agent records bind exact package coordinates; subagents inherit and may narrow them. After controlled injection, adapters translate requests into native configuration and confirm MCP connection or plugin load before the task turn.

## Decisions

- [Project initialization](../../decisions/foundation/0002-safe-project-initialization.md)
- [Local event store and CAS](../../decisions/operations/storage/0003-local-event-store-and-cas.md)
- [Storage bootstrap](../../decisions/operations/storage/0004-project-storage-bootstrap.md)
