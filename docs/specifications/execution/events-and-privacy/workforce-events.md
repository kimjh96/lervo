# Workforce events

Workforce events contain only opaque agent, assignment, lease, handoff, artifact, context-event, role/task, role-version, role-contract-hash, status, generation, expiry, and digest coordinates. They exclude role prose, source paths, task prose, acceptance text, repository paths, prompts, outputs, artifact bodies, reasoning, credentials, and provider configuration.

State and event commit together; event failure restores bytes. Invalid or stale role contracts, contention, expiry, rejected claims, and unauthorized acknowledgments record no execution success.

## Related contracts

[Repository upgrade role bindings](workforce-events/repository-upgrade-role-bindings.md) defines binding refresh authority, events, rollback, and interruption recovery.

Version-four background convergence assignments also support `assignment.convergence.archived`. [Background recovery and retention](../../../specs/background-knowledge-convergence/recovery-and-retention.md) defines its exact required fields, private original-byte archive, terminal evidence, consumer protection, append-before-removal ordering, and failure meaning. This event removes only a proven terminal current projection and never rewrites canonical assignment history.

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
