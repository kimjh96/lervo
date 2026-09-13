# Native repository work admission

Native conversation work has a durable admission boundary. It neither implies admission by the outcome-supervision controller nor creates managed-run evidence. [ADR-0395](../../decisions/coordination/conversations/0395-resumable-native-repository-work-turns.md) defines native execution, authority, sessions, and result delivery.

When the configured Discord speaker is the exact owner of an installed outcome-supervision mandate, the [installed request intake](../execution/outcome-supervision/implementation/node-composition/installed-startup/request-intake.md) takes `repository_work` instead. The native conversation store remains available for hiring history, but it does not admit or execute that supervised turn. This route is selected from reviewed Node configuration and durable agent identity, not message text.

## Admission

Within one immediate SQLite transaction, the Node:

1. Validates source-event identity.
2. Reads any existing turn and provider session.
3. Checks for duplicates.
4. Admits a new turn.

A conflict in conversation, thread, worker, provider, or request-content hash rejects the request and rolls back admission.

## Worker selection

Worker selection preserves the addressed deployment. A product owner that prepares separately deployed workforce children continues to use its configured agent, provider, session, and result scope. Hiring such a child does not activate it as the parent's conversation delegate. Existing delegate rows remain preserved, but they cannot select a worker or expose the child's session or previous results in this mode. Child deployments use their own configured identity.

Legacy hiring without a separately deployable speaker retains explicit conversation-delegate selection. The Node derives this selection from the reviewed deployment configuration and the availability of its configuration path; message text cannot change it. This correction adds no persisted field or event and does not rewrite past turns. Replaying an old source event with different worker coordinates fails identity validation instead of executing again.

## Duplicate handling

Replaying a running source event retains its original attempt and start time across database connections and reopening. It returns a duplicate acknowledgement without starting a provider or performing completion verification. Because elapsed time does not prove non-execution, the acknowledgement promises neither a live process nor eventual delivery from an unobserved process.

Completed source events reuse their verified stored result. Different events retain the existing duplicate scope of conversation, thread, worker, provider, and exact content. Recent completed results remain available within the five-minute window. There is no new table, persisted field, event, or cross-conversation result sharing. Failed turns preserve their existing failure and inspection contract.

## Verification

Verification covers:

- Two database handles and reopening.
- One retained attempt.
- Conflicting-coordinate rollback.
- Responder-level suppression of provider execution and completion verification.

Codex and Claude continue through the common repository-work adapter port.
