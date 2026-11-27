# ADR-0648: Attest a conversation note by its delivery receipt

Status: `accepted`
Decision date: 2026-11-27
Amends: [ADR-0454](0454-open-multi-responder-rooms-and-natural-staffing.md) (how a `conversation_note` is attested)
Related: [ADR-0641](0641-let-agents-mention-each-other-in-core-rooms-and-keep-their-own-context.md), [Lervo ADE rooms](../../../../specifications/execution/product-surfaces/ade-rooms.md)

## Context

ADR-0454 has an agent record a `conversation_note` after each turn it published, "attested by the agent's own delivery receipt". Every other context entry is attested by a review that binds the exact bytes of its summary, such as a passed verification or an approved knowledge review.

A note is the agent's own summary, so no review can bind its words. The receipt, `room.mention.delivered`, carries identifiers, counts, and times only, never text or a content hash (ADR-0641). Without a rule for notes, a promoted note fails the projection's review check, and the projection refuses the agent's whole context. A note is also the first unreviewed text that enters an agent's memory.

## Decision

A `conversation_note` is attested by provenance, not by a review of its content.

- **Binding.**
  - The note's source and its review are both its delivery's `room.mention.delivered`, by event ID and hash.
  - The receipt precedes the promotion.
  - Its `mentionId` resolves, by the ID the mention derives, to a `room.mention.recorded` addressed to the note's agent in the conversation the note's subject names: `conversation/<conversation>/<topic>`.
  - Any lookup that fails refuses the note.
- **One receipt, one note.** The projection refuses a second note that names the same receipt. A later note on the same subject supersedes the earlier one.
- **Self-scope.**
  - A note is in the `work` layer, at medium confidence, internal, and expires.
  - It stays with its own agent: a context handoff that includes one is refused.
  - Where it reaches a session, it reads as the agent's own note, never as verified knowledge.
- **Branch scope.** Only `memoryKind: conversation_note` takes this path. Every other kind still needs a review that binds its exact summary, even when its review is a receipt.
- **v1 records notes for delivered turns only.** A turn an agent took because another agent mentioned it has a receipt. An owner's direct turn to a conversation's lead has none and writes no note.
- **Schema.** Notes and receipts need event schema 16 and 15. Writers record nothing until the repository's writer selects them.

## Consequences

- An agent keeps memory from its conversations without a reviewer in the loop. The memory is labeled self-reported and expires in 30 days.
- The projection stays fail-closed: a note it cannot attest is never written, because the writer checks it against the same projection before appending.
- Room records gain a reader, so `room.mention.recorded` derives its event ID from its mention.

## Verification

- `packages/agent-organization/test/agent-context-note.test.ts`: a note attested by its receipt is accepted. Each of these is refused:
  - a receipt for another agent, another conversation, or after the promotion;
  - a receipt without a recorded mention;
  - high confidence, another layer, restricted sensitivity, or no expiry;
  - another kind with a receipt as its review;
  - a note whose review is no receipt;
  - a second note on the same receipt;
  - a handoff of a note.
