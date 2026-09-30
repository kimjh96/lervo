# Durable supervision storage

The workforce package owns `SupervisionDecisionJournal`, `SupervisionMandateJournal`, `SupervisionResponsibilityReader`, and `SQLiteSupervisionOwnerLeaseStore`. These stores preserve or recover canonical evidence and coordinate owners; none authorizes an execution effect.

The CLI composes reviewed local mandate installation. The explicit Node factory connects local authority, storage, and responsibility recovery. Production startup activation remains open.

[ADR-0439](../../../../decisions/execution/orchestration/governed-work/node-composition/0439-project-complete-scoped-supervision-history.md) defines the task reader's complete workstream projection:

- Incremental control metadata selects validated whole causal trees and explicitly linked runs.
- A second reader retains every original event for those runs and backfills earlier rows when a binding changes.
- Both readers validate the entire encountered chain and retain existing audit, inode, sequence, and byte bounds.
- Unrelated execution bodies are outside this task projection; they are neither deleted nor treated as current repository knowledge.
- Unstable selection fails with `supervision_history_scope_unstable`.
- Peer observations use the existing authority projection.

Supporting specifications:

- [Reviewed installation](storage/installation.md): local plan, apply, inspection, revocation, and source validation.
- [Decisions and artifacts](storage/decisions-and-artifacts.md): journal evidence, CAS artifacts, recovery, and bounds.
- [Canonical responsibilities](storage/responsibilities.md): exact CAS recovery, predecessor history, and Node admission.
- [Owner fences](storage/owner-fences.md): durable leases, commit validation, and recovery limits.
- [Compatibility and verification](storage/compatibility-and-verification.md): envelope activation and test coverage.
