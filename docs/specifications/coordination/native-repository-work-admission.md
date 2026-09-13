# Native repository work admission

Native conversation work has its own durable admission boundary. It does not imply admission by the outcome-supervision controller or manufacture managed-run evidence. [ADR-0395](../../decisions/coordination/conversations/0395-resumable-native-repository-work-turns.md) defines native execution, authority, sessions, and result delivery.

The Node validates source-event identity, reads any existing turn and provider session, checks duplicates, and admits a new turn within one immediate SQLite transaction. A conflicting conversation, thread, worker, provider, or request-content hash rejects the request and rolls back admission.

Replaying a running source event retains its original attempt and start time across database connections and reopening. It returns a duplicate acknowledgement without starting a provider or performing completion verification. Elapsed time does not prove non-execution, so the acknowledgement promises neither a live process nor eventual delivery from an unobserved process.

Completed source events reuse their verified stored result. Different events retain the existing conversation, thread, worker, provider, and exact-content duplicate scope; recent completed results remain available within the five-minute window. This contract introduces no table, persisted field, event, or cross-conversation result sharing. Failed turns preserve their existing failure and inspection contract.

Verification covers two database handles, reopening, one retained attempt, conflicting-coordinate rollback, and responder-level suppression of provider execution and completion verification. Codex and Claude continue through the common repository-work adapter port.
