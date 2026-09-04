# Product outcome convergence

Status: `active`

As of: 2026-09-05

## Outcome

Close the gap between Lervo's Paperclip-, Buzz-, Prime Agent-, and Hermes-derived direction and installed-product scenarios. Source files, unit tests, green CI, and narrowly completed roadmap slices do not establish broader product claims.

A capability is complete only when its named user scenario runs through the installed boundary, preserves authority and evidence meanings, and has a regression test at that boundary.

Acceptance states:

- `implemented`: the exact scenario is evidenced.
- `partial`: useful primitives exist, but the stated outcome does not complete.
- `missing`: no installed route owns the outcome.
- `external product`: Lervo supplies primitives; a separate host owns the interface.

## Acceptance baseline

Baseline revision: `7404d7d985d52014b12326571cf9743092103f54`

Reviewed release: `v0.11.4` at `6a004be19d831d3616e75ea109c95eb8360a5da5`.

Post-release reconciliation confirmed current reviewed-document state in arca-next and Shiflo, retired seven stale metadata-only canonicalization candidates whose responsibilities current canonical sources cover, and restored a clean Lervo operating-attention projection. See [v0.11.4 post-release state reconciliation](../evidence/quality/v0.11.4-post-release-state-reconciliation.md).

Detailed acceptance records:

- [Repository knowledge and Hermes-derived outcomes](product-outcome-convergence/repository-knowledge.md)
- [Prime-Agent-derived execution outcomes](product-outcome-convergence/execution.md)
- [Paperclip-, Buzz-, loop-, graph-, and host-product outcomes](product-outcome-convergence/host-products.md)
- [Foundation outcomes that remain open](product-outcome-convergence/foundation.md)

## Corrected claim boundaries

- Completed natural-language terminal v1 verifies retrieval, workstream checkpoints, declarations, and lifecycle inspection. It provides neither automatic semantic outcome drafting nor proactive user attention.
- Completed branch-safe lifecycle verifies typed candidate creation and exact review. ADR-0327 superseded its older direct durable-rule materialization statement; no installed direct or explicit consumer currently calls the materializer.
- The completed governed-loop roadmap covers manual v1 and a read-only workstream-goal projection. It excludes Prime-Agent-style unattended continuation, native provider-session resume, root-process heartbeat, independent goal mutation, and dynamic topology.
- The completed product-host protocol is a CLI compatibility boundary, not a Paperclip or Buzz product interface.
- Retrieval selection proves only that a source was chosen for context. It does not prove a repeatable workflow, define a capability envelope, or authorize generated skill bytes. Skill candidacy begins with independently grouped workflow evidence, not source selection.
- A successful full repository check proves encoded contracts, not user outcomes absent from them.

## Remaining delivery order

1. Prove one installed natural-language capability journey for an existing reviewed skill: deterministic recommendation, explicit selection, exact instruction loading, adapter activation, invocation, output validation, and completion evidence without generating a skill from retrieved context.
2. Prove fresh-session and cross-provider continuation of one bounded workstream without claiming native provider-session resume or conversation-memory transfer.
3. Connect independently verified repeated workflows to reviewable skill, instruction, or profile candidates with exact review, stale-source handling, activation, effect observation, supersession, and rollback. Retrieval selection alone never enters this path.
4. Extend root-agent and managed-process liveness, direct-message acknowledgment, and reviewed trigger adapters as separate observable outcomes.
5. Add unattended scheduling or dynamic graph topology only after authority, budget, cancellation, uncertain-effect, migration, recovery, and kill-switch contracts pass installed acceptance.
6. Version further product-host routes only with packed external-consumer proof; keep Paperclip-like and Buzz-like interfaces in separate hosts.

The earlier sequence through attention, durable terminal outcomes, checkpointed workspace continuation, product-host protocol v2, release-impact repair, CLI README normalization, and the final `v0.11.4` release gate is complete. Post-release maintenance does not reopen those acceptance results.

## References

- [Product positioning and verified improvement](../research/lervo-product-positioning-and-verified-improvement.md)
- [Agent platform and evolution](../research/lervo-agent-platform-evolution.md)
- [Foundation hardening](foundation-hardening.md)
- [Governed loop and assignment graph](governed-loop-assignment-graph.md)
- [Product-host protocol](../specifications/execution/product-host-protocol.md)
- [Repository knowledge lifecycle convergence](../specs/repository-knowledge-lifecycle-convergence.md)
- [Availability-safe unmanaged terminal hooks](../decisions/execution/providers/hooks/0327-availability-safe-unmanaged-terminal-hooks.md)
- [Terminal observation strengthening v1](../evidence/foundation/terminal-observation-strengthening-v1.md)
