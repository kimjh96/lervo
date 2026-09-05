# Workforce events

Workforce events contain only opaque agent, assignment, lease, handoff, artifact, context-event, role/task, role-version, role-contract-hash, status, generation, expiry, and digest coordinates. They exclude role prose and source paths, task prose, acceptance text, repository paths, prompts, outputs, artifact bodies, reasoning, credentials, and provider configuration.

State and event commit together, restoring bytes on event failure. Invalid or stale role contracts, contention, expiry, and rejected claims record no execution success.

- [Root-agent liveness](workforce-events/root-agent-liveness.md)
- [Routine assignment provenance](workforce-events/routine-assignment-provenance.md)
- [Handoff and connector delivery](workforce-events/handoff-and-connector-delivery.md)
- [Governed-loop projection](workforce-events/governed-loop-projection.md)
- [Cancellation](workforce-events/cancellation.md)
- [Completion preparation](workforce-events/completion-preparation.md)
- [Completion reconciliation](workforce-events/completion-reconciliation.md)
- [Capability registration and activation](workforce-events/capability-registration-and-activation.md)
