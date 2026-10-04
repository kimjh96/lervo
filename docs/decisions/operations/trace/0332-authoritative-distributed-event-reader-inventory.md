# ADR-0332: Authorize distributed event writers from the repository Node fleet

- Status: `accepted`
- Decision date: 2026-09-01

## Context

Reader capability advertisement proves what one observed process can read, not coverage of every configured reader. Hub-enabled repositories therefore remained on the version 1 writer after CLI, Node, Hub, sync, storage, diagnostics, and packed readers could consume mixed version 1/version 2 history.

A separate reader registry would duplicate repository Node membership, add mutable authority, and permit inventory drift. An operator-authored list would mistake evidence bytes for configured-membership authority.

## Decision

Use the existing owner-only `lervo_node_fleet_registry` v1 projection as the complete configured Node membership authority for one Hub-enabled project. Its exact project, canonical repository identity, Node, destination, service, runtime, and health coordinates identify one repository Node. The registered owner-only service definition locates its owner-only runtime configuration, which identifies one Hub destination and expected Hub identity. Do not add a second registry.

Distributed activation evidence uses schema version 2 with exactly three strictly ordered readers: the current local runtime, registered repository Node, and configured Hub. Its authority block contains:

- `kind: repository_node_fleet_v1`;
- the manifest-derived repository identity hash;
- `inventoryHash`, derived from secret-free fleet coordinates and exact service-definition and runtime-config content hashes.

Evidence excludes root, health path, service body, Hub URL, bearer-token path or bytes, credential, prompt, provider output, and event payload. The runtime-config content hash may bind a local credential path without exposing it. Capability reports retain the shared, secret-free `EventReaderCapabilitiesV1` shape.

The Node health publisher additively binds its event-reader report to project, repository identity, and destination. The collector accepts only a safe owner-only snapshot no older than two minutes and no more than five seconds in the future. General status consumers may read older snapshots, but those cannot authorize a new writer. The Hub report comes from the public capability endpoint without loading or sending the bearer credential; it is trusted only when the response proves the configured Hub identity and destination.

Planning and applying remain separate. Before producing a ready plan, the CLI compares supplied distributed evidence with a fresh authoritative observation. Apply observes fleet, service, config, Node health, and Hub again, requiring identical inventory, reader identities, and capabilities. The project domain owns pure exact-membership and revalidation decisions; CLI adapters own filesystem and network observation. The existing durable coordinate transaction owns mutation and recovery.

### Amendment 2026-09-25: a Hub-enabled repository without a Node

Only a repository Node synchronizes repository events to the Hub; no CLI path does. A Hub-enabled clone with no registered Node on its host therefore has exactly one event-database reader: the local runtime. Previously, requiring exactly one fleet member prevented such a clone from activating a newer writer, blocking the terminal change source for every Mac clone whose Node runs on another host.

The evidence collector now checks the fleet registry first. If no registration shares the project ID or canonical repository root, it emits schema version 2 evidence with:

- `kind: repository_node_absent_v1`;
- the manifest-derived repository identity hash;
- an `inventoryHash` over project, repository identity, and root;
- exactly one reader: the local runtime.

Any matching registration, including a stale or inactive one, retains the `repository_node_fleet_v1` path and its Node and Hub requirements. A stale registration must be upgraded or retired, never ignored. Apply observes the registry again; registering a Node between plan and apply makes the plan stale. A later-onboarded Node runs a current runtime and synchronizes to a Hub that must already read the selected version. This relies on release order upgrading the Hub first.

## State and failure semantics

`EventWriterActivationEvidence` schema version 1 remains the local-only form; schema version 2 is the distributed-authority form. The independently versioned selected-writer coordinate stores the resulting configuration hash and reader set. Both evidence forms are bounded to 64 KiB and at most 32 readers.

Failures before mutation retain distinct meanings:

- `reader_inventory_fleet_unavailable`: no exact authoritative fleet member exists;
- `reader_inventory_service_unavailable`: its installed service/config coordinate cannot be established safely;
- `reader_inventory_config_invalid`: repository, destination, or runtime configuration differs;
- `reader_inventory_node_health_unavailable`: Node capability evidence is missing or invalid;
- `reader_inventory_node_health_stale`: the Node observation is outside its freshness bound;
- `reader_inventory_node_identity_mismatch`: health belongs to other coordinates;
- `reader_inventory_hub_unavailable`: Hub capability or identity proof is unavailable;
- `reader_inventory_authority_unavailable` or `reader_inventory_incomplete`: supplied activation evidence lacks required authority or exact membership;
- `reader_inventory_revalidation_required` or `event_writer_plan_stale`: apply lacks a fresh observation or the authoritative observation changed after planning.

Every failure preserves the current coordinate and event history. Hub unavailability does not disable local execution, version 1 writing, replay, or synchronization permitted by current policy.

## Consequences

FH0 can complete without adding mutable product authority. The fleet registry claims only configured deployment coordinates; Node health and Hub transport claim only observations; only the writer plan evaluates activation. A future fleet schema supporting more than one Node per project must version inventory authority and exact-membership policy rather than silently widening the v1 meaning.
