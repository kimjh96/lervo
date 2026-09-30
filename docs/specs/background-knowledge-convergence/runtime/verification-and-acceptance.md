# Verification and remaining acceptance

## Execution-evidence coverage

[ADR-0437](../../../decisions/knowledge/repository/0437-stream-validated-recent-execution-evidence.md) separates streaming recent execution evidence for interactive startup from complete-history compilation. Interactive readiness never establishes complete-history coverage. The legacy complete adapter retains its existing fail-closed limits.

[ADR-0440](../../../decisions/knowledge/repository/canonicalization/0440-page-complete-execution-evidence-for-canonicalization.md) gives full CLI knowledge operations a separate complete adapter with at most four pages, each bounded to 32,768 sources and 16 MiB. It validates every original through the pinned canonical head before returning any page. The tracked source-count and aggregate-byte policy still bounds the combined ordinary, verification, and event corpus. Complete collection alone never establishes semantic approval or full knowledge currency.

## Observed evidence and remaining gates

The [implementation evidence](../../../evidence/quality/background-knowledge-convergence-implementation.md) records native installed no-Hub convergence, restart, and the last idle edit. The [roadmap](../../../roadmap/knowledge/autonomous-background-convergence.md) retains unobserved acceptance gates.

Production activation requires compatible installed readers and reviewed per-project writer/delegation transitions. Repository debt cleanup, AXLI verification prerequisites, and provider spend authority remain separate operations.
