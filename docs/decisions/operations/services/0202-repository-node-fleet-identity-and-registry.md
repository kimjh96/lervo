# ADR-0202: Repository Node Fleet Identity and Registry Foundation

Status: `accepted`
Date: 2026-08-25

## Context

The installed Node service used one global `com.lervo.node` or `lervo-node.service` identity. A second Hub-enabled repository therefore could not have an independently addressable service definition, manager state, or readiness path. Mutable checkout paths and folder names do not establish repository identity.

The existing repository registry provides an owner-only, bounded, atomic user-state pattern. Node fleet reconciliation needs a separate deployment projection because mutable runtime and service coordinates are not repository source truth and must never contain credentials.

## Decision

- A repository Node instance has a deterministic `nfi_<24 lowercase hex>` ID derived from the versioned tuple `projectId + repositoryIdentityHash + nodeId`. Repository root, project name, checkout folder, destination, runtime version, and operating system are excluded, so relocation or runtime upgrade does not silently change service identity.
- Systemd uses `lervo-node-<instance hex>.service`; launchd uses `com.lervo.node.<instance hex>`. Node rendering and management require the exact instance ID. Hub retains the singleton `lervo-hub.service` or `com.lervo.hub` identity.
- Service tools no longer generate or manage former global Node targets. This foundation does not stop, overwrite, or delete an installed legacy service; later reconciliation must inspect and transition it explicitly.
- The user-local `lervo_node_fleet_registry` v1 projection is an owner-only, bounded, atomically replaced JSON file beside the repository registry. It is created only when its first Node instance is registered.
- Each entry binds `serviceInstanceId`, `projectId`, `repositoryIdentityHash`, canonical `repositoryRoot`, `nodeId`, `destinationId`, `runtimeVersion`, `serviceManager`, `serviceIdentity`, `healthPath`, `registeredAt`, and `updatedAt`. Entries sort by project ID and reject duplicate project, root, node, service, or health coordinates.
- Registration reloads the canonical project manifest, requires Hub sync policy, derives the repository identity hash, and rejects symbolic or relative roots. Mutable destination and runtime coordinates may refresh without changing the instance ID or first registration time. A different root or node for the same project remains a conflict until relocation reconciliation is implemented.
- The registry contains no bearer-token path or bytes, credential, trust material, service-definition body, command, transcript, provider content, approval, or event payload. Exact-key validation rejects additional secret-shaped fields instead of ignoring them.

## State and Failure Semantics

The state is named `lervo_node_fleet_registry` with `schemaVersion: 1` and `instances`. It is a local mutable deployment projection, not canonical repository documentation or evidence that a service is installed, active, ready, synchronized, or authorized.

Later [ADR-0332](../trace/0332-authoritative-distributed-event-reader-inventory.md) reuses this bounded projection only as configured membership authority for distributed event-writer planning. It still grants no capability, health, approval, or mutation authority; those meanings remain separate observations and plan decisions.

Invalid identity, coordinate, manifest, policy, path, permissions, structure, duplicate binding, concurrent update, or changed-snapshot conditions fail closed with `node_fleet_*` error codes. Failed or conflicting writes preserve prior registry bytes. Registry mutation emits no event because no runtime effect or synchronization success occurred.

Service status returns the selected instance and manager service identity with normalized activation fields. Activation still requires three stable observations. It does not establish runtime readiness; per-repository `node-runtime-health.json` remains the separate sync, workstream-replication, and remote-control observation.

## Consequences

Two repositories can render, install, inspect, and remove distinct user-service definitions without path collisions, and later reconciliation has a secret-free inventory. Automatic onboarding, credential issuance, transactional upgrade, relocation, legacy-service transition, crash-loop repair, and installed two-repository acceptance remain follow-up work.

This decision narrows the global Node portions of [ADR-0162](../../coordination/remote-control/0162-reloadable-hub-cryptographic-material-and-service-definitions.md) and [ADR-0164](0164-user-runtime-service-management-boundary.md). Their Hub and explicit-write safety contracts remain unchanged.
