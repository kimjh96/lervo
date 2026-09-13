# Bounded dynamic assignment topology

Status: `active`

As of: 2026-09-07

## Purpose

Lervo extends the current workstream's assignment DAG with reviewed branches and joins. This local-first, provider-neutral feature adds assignments depending on current assignments or nodes in the same change. It never rewrites or deletes existing nodes or dependencies.

Canonical authority remains in assignment files, workstreams, roles, execution events, verification, leases, and repository state. `WorkGraphV2` and topology history are rebuildable projections, not another graph database.

## Versioned contracts

`assignment_topology.change` schema v2 contains the current workstream ID, exact expected graph hash, one stable change key, and complete proposed node set. Each node binds:

- A stable node key and task type.
- The exact role version and contract hash, plus an optional capability hash.
- Dependencies on existing assignment IDs and proposed node keys.
- Priority, acceptance criteria, verification suites, approval requirements, and expected paths.

`assignment_topology.plan` schema v2 returns a content-derived change ID, plan ID, request hash, approval hash, assignment snapshot hash, deterministic assignment IDs, resolved dependencies, and branch/join coordinates. It excludes acceptance prose, paths, provider output, credentials, and reviewer identity. `assignment_topology.applied` returns only bounded IDs, digests, status, and created/existing assignment sets.

`WorkGraphV2` adds topology provenance, branch IDs, and replayed topology history to the v1 DAG. Existing assignments migrate lazily with `topology: null`, without canonical assignment rewrites. V1 graph readers and product-host protocols remain unchanged. Product-host protocol v6 advertises only the v2 inspection and reviewed topology-change routes.

## Bounds and validation

A change adds at most 32 nodes. The resulting current-workstream graph contains at most 256 nodes; each node has at most 64 dependencies. Requests are bounded to 128 KiB. Node keys, role coordinates, hashes, priorities, paths, arrays, and dependency IDs are validated before a plan exists.

The controller topologically orders proposed nodes and rejects:

- Cycles, missing proposed dependencies, duplicate dependencies, and dependencies outside the current workstream.
- Stale or missing role contracts.
- Invalid current graphs and graph-hash changes.
- Deterministic-ID collisions and assignment-capacity overflow.

Existing dependencies cannot be edited, so reviewed additions cannot create back-edges into the existing DAG.

## Review, apply, and concurrency

The manual v2 path remains independently reviewed. [Automatic supervision topology](outcome-supervision/implementation/automatic-topology.md) uses a separate versioned operating-policy binding and leaves each addition blocked until its responsibility claim.

Planning is read-only. Manual apply requires all of `--apply <plan-id>`, `--approval <approval-hash>`, `--reviewer <id>`, and `--write`. Under the shared assignment-graph materialization lock, Lervo rebuilds the current graph and role contracts, requires the exact plan and approval, and writes deterministic assignments initially as `blocked`.

Only after every expected node exists with exact content and provenance does Lervo activate the set to `queued`. Existing scheduler and manual claim paths use ordinary DAG dependency eligibility. Topology code does not start providers or bypass leases, approvals, resource budgets, cancellation, verification, or completion reconciliation.

Routine materialization and dynamic topology share one lock because both append assignment graph nodes. The controller owns pure validation and planning; workforce persistence owns atomic assignment files and state transitions; CLI composition owns role resolution, event recording, exact review, and rendering.

## Recovery and replay

Change IDs and assignment IDs are content-derived. If interruption leaves an exact subset of blocked nodes, repeating the same request creates a new current plan with disposition `resume`. Recovery may cross the original expected graph hash only when matching provenance for the same change already exists. It requires the original reviewer digest, rejects extra or mismatched nodes, creates only missing deterministic assignments, rechecks the complete node-key set, and activates all blocked nodes.

Every topology assignment uses the existing `assignment.created` event and adds optional fields:

- `topologyContractVersion`, `topologyChangeId`, `topologyChangeKey`, `topologyRequestHash`, and `topologyPlanId`.
- `topologyApprovalHash`, `topologyReviewerIdDigest`, `topologyExpectedNodeCount`, `topologyNodeSetHash`, and `topologyNodeKey`.
- `initialStatus`, which is `blocked` during materialization.

These fields contain bounded identifiers, hashes, counts, and a key. They exclude reviewer identity, prose, paths, prompts, provider output, and secrets. Old events without these fields remain valid.

Replay groups events by change ID: an exact complete node set is `valid`, a consistent subset is `recovery_required`, and conflicting coordinates or duplicate nodes are `invalid`. Current assignment status remains canonical for activation and execution state.

## Failure meaning

- `graph_changed`, `graph_invalid`, or `workstream_mismatch`: the reviewed base is no longer authoritative.
- `dependency_cycle`, `dependency_duplicate`, or `dependency_escape`: the proposed DAG is unsafe or out of scope.
- `role_contract_missing` or `role_contract_stale`: execution identity cannot be reproduced exactly.
- `topology_bounds_exceeded` or `assignment_capacity`: configured growth would be exceeded.
- `existing_assignment_mismatch`: deterministic recovery coordinates resolve to different canonical content.
- `topology_change_incomplete`: replay observed a recoverable consistent subset.
- `topology_history_conflict`, `topology_history_duplicate_node`, or `topology_history_malformed`: historical evidence is inconsistent; graph v2 inspection fails closed.

Arbitrary rewiring, node deletion, unbounded graph growth, graph-authored provider execution, unversioned automatic review, independent nested-goal mutation, and a second graph store remain unsupported.

## References

- [ADR-0380](../../decisions/execution/orchestration/governed-work/0380-install-bounded-dynamic-assignment-topology.md)
- [Product-host protocol](product-host-protocol.md)
- [Bounded unattended scheduling](unattended-scheduling.md)
- [Dynamic execution graph outcome](../../roadmap/product-outcome-convergence/host-products/execution-graphs.md)
