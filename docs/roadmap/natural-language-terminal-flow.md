# Natural-language terminal development flow

Status: `complete`
Started: 2026-08-24
Completed: 2026-08-25

## Objective

Allow users to ask Codex or Claude ordinary repository questions and request implementations without Lervo commands while preserving verifiable continuation, canonical documentation, knowledge freshness, approvals, optional cross-provider deliberation, and honest unmanaged evidence.

## Acceptance matrix

| Flow | Required result | Status |
| --- | --- | --- |
| Read-only inquiry | Prepare context without requiring an artificial workstream revision or finalization declaration. | complete |
| Repository change | Require an agent/provider workstream checkpoint and bounded turn declaration for an exact repository revision change. | complete |
| Canonicalization | The agent declares current or updated canonical sources; objective lifecycle checks independently reject stale knowledge. | complete |
| User decisions | The current workstream carries bounded unresolved choices and approvals for natural-language resolution in a later turn. | complete |
| Optional deliberation | Explicit task-level Codex-Claude deliberation uses an automatically resolved managed verification suite and binds the completed event. | complete |
| Shiflo pilot | The current CLI is installed, migrated, and exercised through native hook endpoints without manual Lervo bookkeeping; actual provider authorship remains distinguishable from the synthetic endpoint check. | complete |
| Mid-turn hook activation | A Stop first activated after its turn began recovers through valid JSON without a failed hook or fabricated observation. | complete |
| Cross-node continuation | Authorized repository-scoped Hub replication transfers exact workstream snapshots, preserves divergent heads, and never transfers user authority. | complete |

## Non-claims

Direct provider sessions remain unmanaged. Hook preparation, agent declarations, output references, and repository checks do not prove model attention, understanding, or internal use.

See [ADR-0200](../decisions/execution/providers/0200-natural-language-terminal-turn-finalization.md), [ADR-0199](../decisions/knowledge/repository/0199-structured-workstream-continuation-state.md), and [ADR-0201](../decisions/coordination/sync/0201-repository-scoped-workstream-replication.md).
