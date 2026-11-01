# Verification and remaining acceptance

## Execution-evidence coverage

[ADR-0437](../../../decisions/knowledge/repository/0437-stream-validated-recent-execution-evidence.md) separates streaming recent execution evidence for interactive startup from complete-history compilation. Interactive readiness never establishes complete-history coverage.

[ADR-0440](../../../decisions/knowledge/repository/canonicalization/0440-page-complete-execution-evidence-for-canonicalization.md) provides full CLI knowledge operations with a separate complete adapter: at most four pages, each limited to 32,768 sources and 16 MiB. Before returning any page, it validates every original through the pinned canonical head. The tracked source-count and aggregate-byte policy still bounds the combined ordinary, verification, and event corpus. Complete collection alone never establishes semantic approval or full knowledge currency.

[ADR-0554](../../../decisions/execution/verification/0554-bound-what-a-reader-retains-never-history-length.md) removes every head-sequence bound from these sources. When history outgrows a source, it selects the most recent execution events that fit its bounds instead of failing: the interactive window, the legacy 32,768-source and 16 MiB corpus, and the four pages within the tracked policy ceilings. Each source still traverses and validates the whole pinned chain, including execution events outside its window, so the window is deterministic for the observed head. A window that leaves events out is partial evidence, not complete-history coverage. Verification results use a typed read of `verification.completed`. They keep the newest 256 verifications within 16 MiB, and every completion of a returned verification must agree.

## Observed evidence and remaining gates

The [implementation evidence](../../../evidence/quality/background-knowledge-convergence-implementation.md) records native installed no-Hub convergence, restart, and the last idle edit. The [roadmap](../../../roadmap/knowledge/autonomous-background-convergence.md) retains unobserved acceptance gates.

Production activation requires compatible installed readers and reviewed per-project writer/delegation transitions. Repository debt cleanup, AXLI verification prerequisites, and provider spend authority remain separate operations.
