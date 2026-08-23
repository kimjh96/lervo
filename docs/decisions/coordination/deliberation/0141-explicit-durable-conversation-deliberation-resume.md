# ADR-0141: Explicit Durable Conversation Deliberation Resume

- Status: accepted
- Decision date: 2026-08-22

## Context

Reconciliation can identify interrupted/resume, but status must not execute work and the original start job must not mix first-run and resume authority, idempotency, or failure semantics.

## Decision

The only conversation resume command is /lervo deliberate resume <deliberation-id>. Natural language, status, reactions, and model judgments do not count. The human principal needs separate deliberation.resume authority.

The backend first requires the start summary to be exactly interrupted/resume, then stores source event, project/deliberation, principal hash, and first time in a separate mode-0600 deliberation-resumes.sqlite. Topic and policy are reread from checkpoint/project sources. projectId plus sourceEventId deduplicates message delivery; projectId plus deliberationId permits only one request per approved boundary. Another message conflicts without mutation.

Resume jobs reuse queued, leased, settled, uncertain mechanics with distinct resume_worker_lease_expired and deliberation_resume_execution_uncertain codes. Neither auto-replays. Resume state takes precedence in status. Workers may persist only the three terminal outcomes; executor returns of running, unknown, or interrupted become uncertain.

The internal assigned executor either creates a queue-ID workspace for start or passes the same ID and expected project into resumeManagedDeliberationWithStorage. Both validate manifest before providers. Public CLI resume semantics and checkpoint/event/CAS/lease validation stay unchanged.

Reconciliation targets state operation=start or resume. A start can recover interrupted from checkpoint plus inactive lease. Once a resume executor was called, that same checkpoint cannot confirm result; only a consistent completion event settles it.

The app opens resume storage and worker only with a configured resume executor; resume authority without one is invalid configuration. Status and reconciliation never run workers automatically.

## Consequences

An authorized participant can explicitly resume one approved boundary once. Delivery and restart do not duplicate providers, and uncertain resume is never retried merely because the checkpoint remains.
