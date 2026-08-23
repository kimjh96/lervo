# ADR-0047: Role-scoped managed conversation responses and publication evidence

Status: `accepted`
Decision date: 2026-08-20

## Context

The platform-neutral interaction runtime decided which role should answer but did not prove a Codex/Claude run or shared-context injection. A responder returning only text and a permit could reuse another role's context or claim publication without evaluation source.

## Decision

- Place `@lervo/conversation-responder` between interaction, provider adapters, and writing.
- Revalidate message-artifact bytes, digest, and UTF-8, then create a managed request bound to event, policy, decision, role, and message hash. A message is controlled turn input, not a repository document, so it is not E2/E3.
- The responding role denies filesystem write and direct provider messaging. Each reply uses a fresh provider session and injects only role-authorized documents/shared context through existing context contracts.
- A provider-session claim port prevents reuse; the default is process-local, while multi-runner deployments inject a durable indexed implementation.
- After execution, revalidate E2/E3 receipts, source context events, completion artifact, generation, and shared document/hash binding. Read-only runs need no expected write path.
- Require `chat` writing evaluation. A reply candidate carries result/evaluation artifacts and an exact content-bound permit. A separate verifier rereads all sources under the currently resolved writing contract before durable outbox creation.

Add no event. `run.requested` stores only a request digest incorporating the message hash. Message/result/evaluation source stays in CAS, execution evidence in managed-run events, and delivery state in interaction SQLite.

Artifact mismatch, coordinate mismatch, write-capable role, provider-session reuse, repository mutation, invalid E2/E3, or blocked writing fails closed. Generation failure maps to `response_generation_failed`; post-return evaluation tampering maps to `publication_verification_failed`. Create no outbox on either.

Codex/Claude fixtures use independent read-only sessions for two roles, verify restricted shared context and real writing permits, prove raw messages absent from events, reject tampered evaluation hashes, and reuse the common managed-evidence verifier in deliberation.

## Consequences

Participation, provider execution, context evidence, and publication verification have separate owners. ADR-0048 adds authenticated Slack/Discord adapters.
