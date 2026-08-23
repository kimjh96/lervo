# ADR-0047: Role-scoped managed conversation responses and publication evidence

Status: `accepted`
Decision date: 2026-08-20

## Context

The platform-neutral interaction runtime selected the responding role but did not prove a Codex or Claude run or shared-context injection. A responder returning only text and a permit could reuse another role's context or claim publication without evaluation source.

## Decision

- Place `@lervo/conversation-responder` between interaction, provider adapters, and writing.
- Revalidate message-artifact bytes, digest, and UTF-8, then create a managed request bound to the event, policy, decision, role, and message hash. A message is controlled turn input, not a repository document, so it is not E2/E3.
- Deny filesystem writes and direct provider messaging to the responding role. Use a fresh provider session for each reply and inject only role-authorized documents and shared context through existing context contracts.
- Prevent reuse through a provider-session claim port. The default is process-local; multi-runner deployments inject a durable indexed implementation.
- After execution, revalidate E2/E3 receipts, source context events, completion artifact, generation, and shared document/hash binding. Read-only runs need no expected write path.
- Require `chat` writing evaluation. A reply candidate carries result and evaluation artifacts plus an exact content-bound permit. A separate verifier rereads every source under the currently resolved writing contract before durable outbox creation.

Add no event. `run.requested` stores only a request digest incorporating the message hash. Message, result, and evaluation source remain in CAS; execution evidence remains in managed-run events; delivery state remains in interaction SQLite.

Artifact or coordinate mismatch, a write-capable role, provider-session reuse, repository mutation, invalid E2/E3, or blocked writing fails closed. Generation failure maps to `response_generation_failed`; evaluation tampering after return maps to `publication_verification_failed`. Neither creates an outbox.

Codex and Claude fixtures use independent read-only sessions for two roles, verify restricted shared context and real writing permits, prove raw messages are absent from events, reject tampered evaluation hashes, and reuse the common managed-evidence verifier in deliberation.

## Consequences

Participation, provider execution, context evidence, and publication verification have separate owners. ADR-0048 adds authenticated Slack and Discord adapters.
