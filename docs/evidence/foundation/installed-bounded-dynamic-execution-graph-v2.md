# Installed bounded dynamic execution graph v2

Status: `passed`

Observed: 2026-09-07

## Claim

The packed `@lervo/cli` 0.12.0 artifact installs into an empty consumer, exposes product-host protocol v6, applies one exact reviewed additive topology change, replays its branch-and-join history, and executes all four canonical assignments through the existing bounded scheduler in dependency order without a Hub or second graph store.

## Installed scenario

`pnpm smoke:packed-cli` built the real tarball and installed only `@lervo/cli` into a temporary consumer. The fixture:

1. Initialized a minimal local repository, activated the compatible event writer, and started one active workstream.
2. Inspected an empty `WorkGraphV2` and bound its exact graph hash and current developer role version and contract hash into a four-node request: root, two children depending on root, and one join depending on both children.
3. Planned without writes, then applied the exact plan ID and approval hash with an explicit reviewer and `--write` authority.
4. Re-read four queued deterministic assignment files, one branch, one join, valid graph structure, and one complete historically replayed topology change.
5. Hired one Codex-compatible agent and invoked the installed bounded scheduler four times with one-claim and one-managed-run limits. Each invocation completed exactly one newly eligible node; the first three paused at the claim limit, and the final invocation observed `work_complete`.
6. Re-read all four assignments as completed and verified the final managed repository bytes.

The packed check discovered protocol v6 with 29 routes: 10 workforce, 13 operating, and 6 collaboration. Protocols v1 through v5 retained their exact earlier route and unsupported shapes. Only v6 added `assignment_graph.inspect_v2`, `assignment_topology.change`, `assignment_graph_v2`, and reviewed-topology authority.

## Recovery, safety, and privacy evidence

Focused source acceptance also:

- Stopped after the first deterministic assignment and its `assignment.created` topology event were written as `blocked`.
- Rebuilt a plan despite the changed graph hash only because the same exact change provenance existed.
- Required the original reviewer digest, created only the two missing nodes, activated the complete set, and replayed the change as valid.
- Rejected stale graph authority, proposed cycles, same-change foreign nodes, wrong approval hashes, role drift, escaped or duplicate dependencies, and deterministic content mismatches.
- Classified consistent historical subsets as `recovery_required` and malformed, conflicting, or duplicate topology history as invalid.
- Retained only bounded topology IDs, hashes, counts, keys, and initial state in events, redacting reviewer identity, acceptance prose, and paths.

Existing v1 assignments migrate to graph v2 with `topology: null`; old graph and product-host protocols remain unchanged. Topology activation grants no provider, lease, approval, cancellation, budget, verification, or completion authority. The scheduler reaches a node only through the ordinary assignment DAG after its dependencies complete.

## Evidence commands

```text
pnpm quality:check
pnpm exec vitest run packages/work-controller/test/assignment-topology-plan.test.ts packages/work-controller/test/topology-history-projection.test.ts packages/event-contract/test/redaction.test.ts apps/cli/test/assignment-topology-command.test.ts apps/cli/test/application-command.test.ts
pnpm smoke:packed-cli
pnpm check
pnpm release:completion:check --base 74ddbef5
lervo migrate knowledge
lervo knowledge lint
```

Observed focused result: 5 test files and 51 tests passed. The packed consumer installed CLI 0.12.0, completed change `gtc_1f1a31cbb4787ae0495fbc5d`, verified all four managed assignment completions, and passed protocol v6 with 29 routes. The final repository check passed 530 test files and 2,670 tests after the release manifest and SBOM owners refreshed changed packed bytes.

## Limits

This evidence does not claim destructive rewiring, node deletion, arbitrary cycles, unbounded growth, implicit review, independent nested-goal mutation, provider-native session resume, unmanaged whole-request token accounting, an operating-system daemon, or Hub availability. Additive graph v2 remains a projection over canonical assignments and events.

## References

- [Bounded dynamic assignment topology](../../specifications/execution/dynamic-assignment-topology.md)
- [ADR-0380](../../decisions/execution/orchestration/governed-work/0380-install-bounded-dynamic-assignment-topology.md)
- [Dynamic execution graphs](../../roadmap/product-outcome-convergence/host-products/execution-graphs.md)
- [Product-host protocol](../../specifications/execution/product-host-protocol.md)
