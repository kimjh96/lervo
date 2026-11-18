# ADR-0380: Install bounded dynamic assignment topology

- Status: `accepted`
- Decision date: 2026-09-07

Partially superseded by [ADR-0560](../../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md): the manual route part is removed. Lervo no longer ships `lervo assignment topology` or the product-host protocol v6 graph routes. The topology change contracts, planning, `WorkGraphV2`, history projection, and assignment creation stay because Node runtime supervision writes topology through them.

## Context

Assignment dependencies already formed a rebuildable acyclic graph, routines created fixed reviewed templates, and the bounded scheduler executed eligible nodes. Adding a newly reviewed branch or join required unrelated assignment mutations, with no versioned recovery or historical replay contract for multi-node topology changes.

Direct dependency edits would require atomic rewrites across existing canonical files, invalidate active leases, and make interrupted rollback ambiguous. A mutable graph service would duplicate assignment authority and violate local-first operation.

## Decision

Introduce additive `assignment_topology.change`, plan, receipt, and `WorkGraphV2` contracts. Changes may add a bounded set of deterministic assignments depending on current-workstream assignments or nodes in the same change. They may not modify or delete existing nodes or dependencies.

Require the exact current graph hash, current workstream, exact role versions and contract hashes, acyclic proposed dependencies, bounded graph growth, a content-derived plan ID and approval hash, explicit reviewer identity, and explicit write authority. Exclude reviewer identity from records; expose only its digest.

Materialize every node as `blocked` under the assignment-graph lock used by fixed routines. Record optional topology provenance on the existing `assignment.created` event, verify the complete deterministic node set, then activate nodes to `queued`. Existing claim and scheduler paths retain dependency, role, capability, path, lease, cancellation, approval, budget, verification, and completion authority.

Permit interruption recovery only for the same content-derived change, exact node content, and original reviewer digest. A recovery plan may tolerate an expected graph hash changed by its own partial nodes, but must reject foreign, extra, or mismatched nodes. Create only missing assignments and recheck the full set before activation.

Project historical topology from bounded `assignment.created` fields. Exact complete sets are valid, consistent subsets require recovery, and conflicts or duplicates are invalid. Existing events and assignments migrate lazily: missing topology is `null`, v1 graph readers remain compatible, and protocol v6 alone advertises v2 graph inspection and reviewed mutation.

Assign responsibilities:

- Application contracts: public shapes.
- Controller: pure validation, deterministic planning, graph v2, and historical projection.
- Workforce: canonical assignment persistence and activation.
- CLI: role resolution, lock composition, event append, review checks, and presentation.
- Provider adapters: unchanged.

## Privacy and failure meaning

Plans, receipts, provenance, and events contain bounded identifiers, hashes, counts, priorities, and state. Topology history must not persist reviewer identity, acceptance prose, paths, prompts, provider output, credentials, or native errors.

Validation failures create no assignments. A partial exact set stays blocked and reports recovery required. A stale graph without matching partial provenance, stale role contract, cycle, escaped dependency, growth excess, deterministic-ID mismatch, reviewer mismatch, or history conflict fails closed. The change grants neither provider execution nor automatic approval.

## Consequences

Lervo can review, recover, replay, and execute bounded branch-and-join additions without a Hub or second task store. Additive-only changes make failure and migration tractable. Destructive rewiring requires a separate contract with stronger lease and rollback semantics.

## References

- [Bounded dynamic assignment topology](../../../../specifications/execution/dynamic-assignment-topology.md)
- [Dynamic execution graph outcome](../../../../roadmap/product-outcome-convergence/host-products/execution-graphs.md)
- [ADR-0336](0336-adopt-headless-governed-loop-and-assignment-graph.md)
- [ADR-0379](0379-install-bounded-unattended-assignment-scheduling.md)
