# Workforce events

Workforce events contain only opaque agent, assignment, lease, handoff, artifact, context-event, role/task, role-version, role-contract-hash, status, generation, expiry, and digest coordinates. They exclude role prose and source paths, task prose, acceptance text, repository paths, prompts, outputs, artifact bodies, reasoning, credentials, and provider configuration.

State and event commit together; event failure restores bytes. Invalid or stale role contracts, contention, expiry, rejected claims, and unauthorized acknowledgments record no execution success.

## Repository upgrade role bindings

Repository upgrade refreshes a stale shipped built-in agent with `agent.identity.changed` and `changeKind=role_binding`. It may refresh a repository-defined role binding only after the current plan's exact per-role operation ID and approval hash are supplied. Each stale assignment refresh emits `assignment.role.binding.changed`, requiring `assignmentId`, previous and next role version, role contract hash, required capability hash, `roleId`, and `revision`.

A required capability hash changes only when it exactly matches one stale agent binding with one unambiguous replacement. Repository-role approval changes generated binding records only and never rewrites `.lervo/roles`. The event excludes task text, role prose, source paths, capability bodies, provider configuration, and credentials.

Event rejection restores the individual state file. Interruption can leave earlier records refreshed; the next content-bound plan resumes only the remaining records. No wrapper event claims whole-stage completion.

## Related contracts

Version-four background convergence assignments additionally support `assignment.convergence.archived`. Its exact required fields, private original-byte archive, terminal evidence, consumer protection, append-before-removal ordering, and failure meaning are defined in [background recovery and retention](../../../specs/background-knowledge-convergence/recovery-and-retention.md). This event removes only a proven terminal current projection and never rewrites canonical assignment history.

- [Root-agent liveness](workforce-events/root-agent-liveness.md)
- [Routine assignment provenance](workforce-events/routine-assignment-provenance.md)
- [Conversation knowledge-job assignment provenance](workforce-events/knowledge-job-assignment-provenance.md)
- [Handoff and connector delivery](workforce-events/handoff-and-connector-delivery.md)
- [Governed-loop projection](workforce-events/governed-loop-projection.md)
- [Cancellation](workforce-events/cancellation.md)
- [Completion preparation](workforce-events/completion-preparation.md)
- [Completion reconciliation](workforce-events/completion-reconciliation.md)
- [Capability registration and activation](workforce-events/capability-registration-and-activation.md)
- [Assignment reopening and recovery coordinates](../outcome-supervision/implementation/managed-execution/assignment-recovery.md)
- [Unstarted assignment amendment coordinates](../outcome-supervision/implementation/assignment-amendments.md)
