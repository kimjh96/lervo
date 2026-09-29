# Background knowledge convergence

Status: `active`
As of: 2026-09-27

The local implementation closes continuation gaps between canonicalization, document normalization, and repository knowledge maintenance under [ADR-0434](../decisions/knowledge/repository/canonicalization/0434-converge-background-canonicalization-normalization-and-knowledge.md). The [runtime contract](background-knowledge-convergence/runtime.md) defines implemented commands, states, privacy, and activation. A privately installed Codex canary reached verified currency without a Hub; the existing production fleet remains on its previously activated behavior.

The reviewed split documents below retain the design snapshot. Their proposed-event and activation wording describes that snapshot; the runtime contract and implementation evidence govern current implementation status.

- [Authority and completion](background-knowledge-convergence/authority-and-completion.md): independent review, user-owned bytes, integration, source currency, and truthful completion.
- [Scheduling and events](background-knowledge-convergence/scheduling-and-events.md): baseline discovery, durable continuation, resource bounds, compatibility, and recovery.
- [Delivery roadmap](../roadmap/knowledge/autonomous-background-convergence.md): ordered implementation and concrete acceptance gates.
- [Implementation evidence](../evidence/quality/background-knowledge-convergence-implementation.md): native installed convergence, restart, idle edits, and remaining acceptance limits.
- [Current audit](../evidence/quality/background-knowledge-convergence-audit.md): source findings, installed observations, and verification limits.

Candidate generation, review, source integration, and projection refresh are separate outcomes. None independently proves that the repository's knowledge is current.
