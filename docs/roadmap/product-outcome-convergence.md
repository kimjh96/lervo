# Product outcome convergence

Status: `active`

As of: 2026-09-06

## Outcome

Close the gap between Lervo's Paperclip-, Buzz-, Prime Agent-, and Hermes-derived direction and installed-product scenarios. Source files, unit tests, green CI, and completed narrow roadmap slices do not establish broader product claims.

A capability is complete only when its named user scenario runs through the installed boundary, preserves authority and evidence meanings, and has a regression test at that boundary.

Each outcome has exactly one acceptance owner and one state:

- `implemented`: the exact scenario is evidenced.
- `delivery required`: Lervo owns the accepted outcome, but the exact installed scenario is incomplete. Lower-level primitives are evidence, not fractional acceptance.
- `external dependency`: the outcome requires provider or platform support and evidence Lervo cannot supply. It becomes actionable Lervo delivery only when that dependency exists.
- `external product`: Lervo supplies primitives; a separate host owns the outcome outside Lervo's core delivery scope.

Do not use intermediate states to imply narrower slices satisfy incomplete outcomes. Split mixed outcomes into installed Lervo behavior, Lervo-owned remaining delivery, external dependencies, and external products.

## Acceptance baseline

Baseline revision: `7404d7d985d52014b12326571cf9743092103f54`

Reviewed release: `v0.11.4` at `6a004be19d831d3616e75ea109c95eb8360a5da5`.

Post-release reconciliation confirmed reviewed-document state in arca-next and Shiflo, retired seven stale metadata-only canonicalization candidates whose responsibilities current canonical sources cover, and restored a clean Lervo operating-attention projection. See [v0.11.4 post-release state reconciliation](../evidence/quality/v0.11.4-post-release-state-reconciliation.md).

Detailed acceptance records:

- [Repository knowledge and Hermes-derived outcomes](product-outcome-convergence/repository-knowledge.md)
- [Prime-Agent-derived execution outcomes](product-outcome-convergence/execution.md)
- [Paperclip-, Buzz-, loop-, graph-, and host-product outcomes](product-outcome-convergence/host-products.md)
- [Open foundation outcomes](product-outcome-convergence/foundation.md)

## Corrected claim boundaries

- Completed natural-language terminal v1 verifies retrieval, workstream checkpoints, declarations, and lifecycle inspection. It provides neither automatic semantic outcome drafting nor proactive user attention.
- Completed branch-safe lifecycle verifies typed candidate creation and exact review. ADR-0327 still forbids direct-hook effect grounding and mutation; the installed explicit durable-instruction command owns candidate creation and exact reviewed materialization outside the hook.
- The completed governed-loop roadmap and subsequent installed extensions cover manual execution, read-only workstream goals, liveness, bounded unattended continuation, and reviewed additive dynamic topology. Native provider-session resume and independent nested-goal mutation remain outside those contracts.
- The completed product-host protocol is a CLI compatibility boundary, not a Paperclip or Buzz product interface.
- Retrieval selection proves only source selection for context. It does not prove a repeatable workflow, define a capability envelope, or authorize generated skill bytes. Skill candidacy starts with independently grouped workflow evidence.
- The installed natural-language capability journey proves two independently verified workflows can become a generated portable-skill package through exact review, stale-source supersession, four-file promotion, project authorization, dependency-preserving migration, deterministic recommendation plus explicit selection, provider-confirmed MCP activation, result validation, completion evidence, and explicit post-promotion effect comparison. The comparison retains unestablished attribution and authorizes no rollback. The journey does not prove model reliance or authorize generation from retrieval selection alone.
- The installed agent-profile journey uses exact role activation and passed-verification pairs from independent managed runs, exact review, user-owned role activation and resolution, and explicit rollback. The separate effect protocol retains unestablished attribution and never authorizes rollback.
- A successful full repository check proves encoded contracts, not user outcomes absent from them.

## Delivery status and remaining boundaries

No accepted Lervo-owned product-convergence outcome remains in `delivery required` state.

Managed provider execution enforces exact total, input, cached-input, output, reasoning-output, and per-run stage-duration budgets without estimating unmanaged whole-request usage. See [managed execution resource budgets v1](../evidence/foundation/managed-execution-resource-budgets-v1.md).

Reviewed direct-message triggering and explicit handoff acknowledgment are installed through product-host protocol v4. They separate reviewed input, routing, delivery, acknowledgment, action, and provider execution and do not claim a live external message receiver.

Bounded unattended scheduling is installed through product-host protocol v5. One foreground invocation can poll, exact-revision claim, managed-execute, verify, and complete queued assignments while preserving current checkpoints, resource budgets, leases, retry limits, cancellation and approval boundaries, fail-closed uncertain effects, escalation, and a repository-local kill switch.

Bounded dynamic graph branches, joins, reviewed topology changes, migration, recovery, historical replay, and installed dependency-ordered execution are implemented through graph v2 and product-host protocol v6.

Provider-native session memory and direct unmanaged whole-task token accounting remain `external dependency`; they do not block implemented portable checkpoint-resume and managed-resource outcomes. Unified interactive interfaces remain `external product`. Future product-host routes require packed external-consumer proof.

The installed authenticated webhook closes the first live-trigger outcome through shared authority, replay, cumulative-budget, uncertain-effect, and recovery contracts. The earlier sequence through attention, durable terminal outcomes, checkpointed workspace continuation, product-host protocols v2 through v4, release-impact repair, CLI README normalization, and the final `v0.11.4` release gate is complete. Product-host protocol v5 adds bounded unattended execution without reopening those acceptance results.

## References

- [Product positioning and verified improvement](../research/lervo-product-positioning-and-verified-improvement.md)
- [Agent platform and evolution](../research/lervo-agent-platform-evolution.md)
- [Foundation hardening](foundation-hardening.md)
- [Governed loop and assignment graph](governed-loop-assignment-graph.md)
- [Product-host protocol](../specifications/execution/product-host-protocol.md)
- [Repository knowledge lifecycle convergence](../specs/repository-knowledge-lifecycle-convergence.md)
- [Availability-safe unmanaged terminal hooks](../decisions/execution/providers/hooks/0327-availability-safe-unmanaged-terminal-hooks.md)
- [Terminal observation strengthening v1](../evidence/foundation/terminal-observation-strengthening-v1.md)
- [Installed natural-language capability journey v1](../evidence/foundation/installed-natural-language-capability-journey-v1.md)
- [Installed fresh-session cross-provider continuation v1](../evidence/foundation/installed-fresh-session-cross-provider-continuation-v1.md)
- [Evidence-bound agent-profile candidates v1](../evidence/foundation/evidence-bound-agent-profile-candidates-v1.md)
- [Authenticated live webhook trigger v1](../evidence/foundation/authenticated-live-webhook-trigger-v1.md)
- [Installed bounded unattended scheduler v1](../evidence/foundation/installed-bounded-unattended-scheduler-v1.md)
- [Installed bounded dynamic execution graph v2](../evidence/foundation/installed-bounded-dynamic-execution-graph-v2.md)
