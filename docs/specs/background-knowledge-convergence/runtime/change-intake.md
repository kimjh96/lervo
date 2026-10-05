# Per-change knowledge intake

Status: `active`
As of: 2026-10-05

[ADR-0457](../../../decisions/knowledge/documents/0457-degrade-knowledge-intake-per-file-and-consolidate-documents.md) replaces whole-job rejection with per-file degradation for `knowledge:repository` jobs, from `repository.change.completed` to `repository.knowledge.resolved`.

- [Intake and resolution](change-intake/intake-and-resolution.md): inclusion policy, per-file outcomes, sub-jobs, and resolution fields.
- [The v4 reviewer](change-intake/v4-reviewer.md): authority, admission, budgets, provider availability, and usage attribution.
- [Re-queue of stalled jobs](change-intake/requeue.md): eligibility, superseding resolutions, and scan state.
