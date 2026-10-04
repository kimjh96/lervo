# Conversation intent normalization and immutable evidence

## Resolver boundary

`apps/node-runtime/src/conversation-intent-resolver.ts` classifies meaning through a provider-neutral, no-capability JSON runner. Messages, prior turns, and workstream data are untrusted classification input. Classification grants no execution authority.

The response contains exactly five fields:

- intent: `answer`, `continue_work`, or `clarify`.
- confidence: high, medium, or low.
- participation: relevant or not_relevant.
- effect: exactly kind, nickname, name, and specification; unused arguments are null.
- executionProfile: routine, reasoning, or review for repository work; null for every other effect.

Parsing normalizes effect to kind and only its applicable argument. Answer and clarification require `none`; continue-work requires a non-none effect. An otherwise valid unavailable effect becomes high-confidence clarification with `none`, preserving participation and clearing executionProfile. The resolver returns adapter version 3 and a SHA-256 digest of the normalized body.

Classifier instructions distinguish injected-context answers from live inspection or execution, separate durable supervision goals from bounded repository work, and require configured identities and runtime targets rather than invented coordinates.

## Normalized effect bounds

- None, repository work, and supervision-goal request contain only kind.
- Nicknames contain 1–32 Unicode code points and no NUL.
- Guild text-channel names begin with a lowercase ASCII letter or digit, followed by lowercase ASCII letters, digits, underscores, or hyphens; maximum length is 100.
- Public-thread names contain 1–100 Unicode code points and no NUL.
- Hiring, delegation, and deliberation specifications are nonempty, NUL-free strings limited respectively to 512, 1,024, and 4,096 Unicode code points. The validator does not parse hiring or delegation specifications as JSON.
- Requested-runtime open and close use an identifier beginning with a lowercase letter, followed by lowercase letters, digits, underscores, or hyphens; maximum length is 64.

## Immutable SQLite evidence

`apps/node-runtime/src/conversation-intent-store.ts` stores resolutions keyed by source event ID and bound to the message content hash. Rows contain provider/model evidence, adapter version, normalized classification, effect JSON, result digest, and resolution time. Update and delete triggers preserve immutable rows. Recording inserts only when absent, then compares all stored coordinates with requested values; disagreement is a conflict.

Opening rejects an existing database path that is not a regular file or is a symbolic link. It creates the parent directory with requested mode 0700 and sets the database file to 0600. SQLite uses WAL, FULL synchronous mode, and a five-second busy timeout. Missing supported columns are added without rewriting existing resolution rows.

The reader accepts adapter versions 1 through 4. Legacy null effect JSON maps continue-work to repository work and other intents to none. Legacy null participation maps to relevant. A null execution profile is retained. These compatibility interpretations do not reclassify the original message.

## Requested and observed model evidence

Version 4 separately stores requestedModel, model, observedModelIds, answerModelEvidence, and modelUnavailableReason:

- Model identifiers must satisfy the bounded identifier pattern.
- Observed identifiers are unique and limited to 32.
- A non-null answer model must occur in observedModelIds, use thread_start, response_object, or assistant_message evidence, and have no unavailable reason.
- A null answer model requires unavailable evidence and a bounded lowercase reason code.

The supplied resolver emits version 3. Store support for version 4 does not prove that a version-4 producer was invoked. Stored requested routes do not establish the provider-observed model, answer quality, execution success, or delivery.
