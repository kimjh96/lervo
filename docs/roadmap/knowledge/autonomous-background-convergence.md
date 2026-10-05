# Autonomous background knowledge convergence

Status: `in_progress`
As of: 2026-10-05

## Outcome

Drain existing and new canonicalization, normalization, and knowledge debt through accountable background agents without another human turn. [ADR-0434](../../decisions/knowledge/repository/canonicalization/0434-converge-background-canonicalization-normalization-and-knowledge.md) and the [implementation contract](../../specs/background-knowledge-convergence.md) define the design; the [audit](../../evidence/quality/background-knowledge-convergence-audit.md) records defects and evidence limits.

The local runtime is implemented. A [privately installed native Codex canary](../../evidence/quality/background-knowledge-convergence-implementation.md) verified changed canonical drafts through independent review, real Git integration, normalization, and no-Hub currency. Earlier canaries verified restart and the last idle document edit. Focused recovery covers failed-assignment reopening, verified Git completion before root apply, safe workspace cleanup and archival, successive integration generations, new source roots, and exact normalization lineage.

[ADR-0466](../../decisions/coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md) cross-host ownership is implemented in source: a Hub owner lease, a commit fence, and standalone contention detection. It is not yet installed on the Mac and WSL hosts.

Production fleet activation and remaining installed acceptance gates remain open. Backlog cleanup alone does not satisfy the outcome.

## Plan and evidence

- [Delivery order](autonomous-background-convergence/delivery.md): settlement safety, delegation, integration, normalization, and lifecycle completion.
- [Acceptance gates](autonomous-background-convergence/acceptance.md): observed completion and remaining installed requirements.
- [Validation and rollout](autonomous-background-convergence/rollout.md): activation prerequisites and installed verification history.
