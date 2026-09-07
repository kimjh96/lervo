# Remote execution result conversation

Part of [Discord remote continuation](../discord.md).

State: `delivery required`.

Outcome: managed execution completion, failure, and a publication-approved result return to the originating Discord thread with exact delivery, run, workstream, and assignment coordinates.

The current acknowledgement proves queueing only. Hub receipts contain verified run identity and completion status but intentionally exclude provider output.

Completion requires a bounded result-publication contract and durable correlation. It must not expose raw prompts, provider errors, credentials, unrestricted CAS URIs, or unverified output.
