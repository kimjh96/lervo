# Product outcome convergence

Status: `active`

As of: 2026-09-07

## Outcome

Close the gap between Lervo's Paperclip-, Buzz-, Prime Agent-, and Hermes-derived direction and installed-product scenarios. Source files, unit tests, green CI, and completed narrow roadmap slices do not establish broader product claims.

A capability is complete only when its named user scenario runs through the installed boundary, preserves authority and evidence meanings, and has a regression test at that boundary.

Each outcome has exactly one acceptance owner and one state:

- `implemented`: the exact scenario is evidenced.
- `delivery required`: Lervo owns the accepted outcome, but the exact installed scenario is incomplete. Lower-level primitives are evidence, not fractional acceptance.
- `external dependency`: provider or platform support and evidence beyond Lervo's control are required. Lervo delivery becomes actionable only when that dependency exists.
- `external product`: Lervo supplies primitives; a separate host owns the outcome outside Lervo's core delivery scope.

Do not use intermediate states to imply narrower slices satisfy incomplete outcomes. Split mixed outcomes into installed Lervo behavior, remaining Lervo-owned delivery, external dependencies, and external products.

## Acceptance baseline

Baseline revision: `7404d7d985d52014b12326571cf9743092103f54`

Reviewed release: `v0.11.4` at `6a004be19d831d3616e75ea109c95eb8360a5da5`.

Post-release reconciliation confirmed reviewed-document state in arca-next and Shiflo, retired seven stale metadata-only canonicalization candidates whose responsibilities current canonical sources cover, and restored a clean Lervo operating-attention projection. See [v0.11.4 post-release state reconciliation](../evidence/quality/v0.11.4-post-release-state-reconciliation.md).

Acceptance records and boundaries:

- [Repository knowledge and Hermes-derived outcomes](product-outcome-convergence/repository-knowledge.md)
- [Prime-Agent-derived execution outcomes](product-outcome-convergence/execution.md)
- [Paperclip-, Buzz-, loop-, graph-, and host-product outcomes](product-outcome-convergence/host-products.md)
- [Open foundation outcomes](product-outcome-convergence/foundation.md)
- [Corrected claim boundaries](product-outcome-convergence/claim-boundaries.md)
- [Delivery status and remaining boundaries](product-outcome-convergence/delivery-status.md)

## References

- [Managed execution resource budgets v1](../evidence/foundation/managed-execution-resource-budgets-v1.md)
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
