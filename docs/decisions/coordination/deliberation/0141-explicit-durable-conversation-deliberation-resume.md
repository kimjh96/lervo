# ADR-0141: Explicit Durable Conversation Deliberation Resume

- Status: accepted
- Decision date: 2026-08-22

## Context

Reconciliation can identify `interrupted`/`resume`, but status must not execute work. The original start job must not mix initial-run and resume authority, idempotency, or failure semantics.

## Decision

The only conversation resume command is `/lervo deliberate resume <deliberation-id>`. Natural language, status, reactions, and model judgments do not count. The human principal requires separate `deliberation.resume` authority.

The backend first requires the start summary to be exactly `interrupted`/`resume`. It then stores the source event, project and deliberation coordinates, principal hash, and first request time in a separate mode-0600 `deliberation-resumes.sqlite`. Topic and policy are reread from checkpoint and project sources.

`projectId` plus `sourceEventId` deduplicates message delivery. `projectId` plus `deliberationId` permits only one request for each approved boundary. Another message conflicts without mutation.

Resume jobs reuse `queued`, `leased`, `settled`, and `uncertain` mechanics, with distinct `resume_worker_lease_expired` and `deliberation_resume_execution_uncertain` codes. Neither condition triggers automatic replay. Resume state takes precedence in status.

Workers may persist only the three terminal outcomes. Executor results of `running`, `unknown`, or `interrupted` become uncertain.

The internal assigned executor either creates a queue-ID workspace for start or passes the same ID and expected project to `resumeManagedDeliberationWithStorage`. Both validate the manifest before providers run. Public CLI resume behavior and checkpoint, event, CAS, and lease validation remain unchanged.

Reconciliation targets state with `operation=start` or `operation=resume`. A start may recover `interrupted` from a checkpoint plus an inactive lease. After a resume executor has been called, that checkpoint cannot confirm the result; only a consistent completion event settles it.

The app opens resume storage and a resume worker only when a resume executor is configured. Resume authority without that executor is invalid configuration. Status and reconciliation never run workers automatically.

## Consequences

An authorized participant may explicitly resume one approved boundary once. Delivery retries and restarts do not duplicate provider execution, and an uncertain resume is never retried merely because its checkpoint remains.
