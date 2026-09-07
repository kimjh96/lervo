# Remote execution result conversation

Part of [Discord remote continuation](../discord.md).

State: `delivery required`.

Return managed execution completion, failure, and a publication-approved result to the originating Discord thread with exact delivery, run, workstream, and assignment coordinates.

The current acknowledgement proves queueing only. Hub receipts contain verified run identity and completion status but intentionally exclude provider output.

The bounded implementation now:

- Persists origin correlation before the Discord queue acknowledgement.
- Observes terminal receipts before acknowledging their lease.
- Validates exact continuation and managed-run evidence.
- Evaluates successful output under a privacy-aware writing contract.
- Retries one prepared outbound identity across restarts.

Rejection, execution failure, invalid evidence, blocked writing, evaluator failure, and oversized output return fixed safe status rather than raw material.

The outcome remains `delivery required` until the installed always-on Node completes one real Discord Gateway to Hub to managed provider to originating-thread round trip while the source Mac is offline. Simulated Gateway, restart, and packed-consumer tests do not satisfy this external acceptance boundary.

See [ADR-0383](../../../../decisions/coordination/conversations/0383-durable-conversation-execution-result-return.md).
