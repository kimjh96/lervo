# ADR-0332: Authorize distributed event writers from the repository Node fleet

- Status: `accepted`
- Decision date: 2026-09-01

## Context

Reader capability advertisement proves what one observed process can read. It does not
prove that the observation covers every configured reader. Hub-enabled repositories
therefore remained on the version 1 writer even after the CLI, Node, Hub, sync, storage,
diagnostics, and packed readers could consume mixed version 1/version 2 history.

Creating another reader registry would duplicate repository Node membership, introduce
new mutable authority, and allow the two inventories to drift. Accepting an operator-
authored list would mistake evidence bytes for configured-membership authority.

## Decision

Use the existing owner-only `lervo_node_fleet_registry` v1 projection as the complete
configured Node membership authority for one Hub-enabled project. Its exact project,
canonical repository identity, Node, destination, service, runtime, and health
coordinates identify one repository Node. The registered owner-only service definition
locates its owner-only runtime configuration; that configuration identifies one Hub
destination and expected Hub identity. No second registry is added.

Distributed activation evidence uses schema version 2. It contains exactly three
strictly ordered readers: the current local runtime, the registered repository Node,
and the configured Hub. Its authority block contains:

- `kind: repository_node_fleet_v1`;
- the manifest-derived repository identity hash; and
- `inventoryHash`, derived from the secret-free fleet coordinates plus the exact
  service-definition and runtime-config content hashes.

The evidence contains no root, health path, service body, Hub URL, bearer-token path or
bytes, credential, prompt, provider output, or event payload. The runtime-config content
hash may bind a local credential path without exposing that path. Capability reports
remain the shared secret-free `EventReaderCapabilitiesV1` shape.

The Node health publisher additively binds its event-reader report to project,
repository identity, and destination. The collector accepts only a safe owner-only
snapshot no older than two minutes and no more than five seconds in the future. Older
health snapshots remain readable by general status consumers, but cannot authorize a
new writer. The Hub report is read from the public capability endpoint without loading
or sending the bearer credential and is trusted only when the response proves the
configured Hub identity and destination.

Planning and applying remain separate. The CLI compares supplied distributed evidence
with a fresh authoritative observation before producing a ready plan. Apply observes
the fleet, service, config, Node health, and Hub again and requires the same inventory,
reader identities, and capabilities. The project domain owns pure exact-membership and
revalidation decisions; CLI adapters own filesystem and network observation; the
existing durable coordinate transaction owns mutation and recovery.

## State and failure semantics

`EventWriterActivationEvidence` schema version 1 remains the local-only form. Schema
version 2 is the distributed-authority form. The selected writer coordinate remains
versioned independently and stores the resulting configuration hash and reader set.
Both evidence forms are bounded to 64 KiB and at most 32 readers.

Failures before mutation retain distinct meanings:

- `reader_inventory_fleet_unavailable`: no exact authoritative fleet member exists;
- `reader_inventory_service_unavailable`: its installed service/config coordinate
  cannot be established safely;
- `reader_inventory_config_invalid`: repository, destination, or runtime config differs;
- `reader_inventory_node_health_unavailable`: Node capability evidence is missing or
  invalid;
- `reader_inventory_node_health_stale`: the Node observation is outside its freshness
  bound;
- `reader_inventory_node_identity_mismatch`: health belongs to other coordinates;
- `reader_inventory_hub_unavailable`: Hub capability or identity proof is unavailable;
- `reader_inventory_authority_unavailable` or `reader_inventory_incomplete`: supplied
  activation evidence lacks the required authority or exact membership; and
- `reader_inventory_revalidation_required` or `event_writer_plan_stale`: apply lacks a
  fresh observation or the authoritative observation changed after planning.

Every failure preserves the current coordinate and event history. Hub unavailability
does not disable local execution, version 1 writing, replay, or synchronization already
permitted by current policy.

## Consequences

FH0 can complete without adding mutable product authority. The fleet registry continues
to claim configured deployment coordinates only; Node health and Hub transport continue
to claim observations only; the writer plan alone evaluates activation. A future fleet
schema supporting more than one Node for a project must version the inventory authority
and exact-membership policy rather than silently widening this v1 meaning.
