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
  - The note's subject is `conversation/<conversation>/<mention>`, the 24 hex characters of each ID. It carries identifiers only, so a subject that syncs to the Hub never carries words from the conversation.
  - The receipt names the subject's mention. That mention resolves, by the ID it derives, to a `room.mention.recorded` addressed to the note's agent in the subject's conversation.
  - The mention came from another agent: its `fromAgentId` is an agent, never the owner's null and never the note's own agent. An agent cannot mint a receipt by mentioning itself.
  - Order is by sequence, so a projection accepts the same notes at every head: the mention's record precedes the receipt, and the receipt precedes the promotion. The receipt also precedes the note's observation and its promotion in time.
  - Any lookup that fails refuses the note.
- **One receipt, one note.** The projection refuses a second note that names the same receipt, including after the first is superseded.
- **Self-scope.**
  - A note is in the `work` layer, at medium confidence, and internal. It expires within 30 days of its observation.
  - A note may supersede only another note, never reviewed memory such as a verified work outcome.
  - It stays with its own agent: a context handoff that includes one is refused.
  - Its summary is at most 2,048 bytes, which holds a 512-character note in any script.
  - It may reach a session only through the slice-3 room block, which must recall only the agent's own newest notes and label them as written by the agent and unreviewed. Until that block ships, notes reach no session. The node runtime's materialized agent context, which reads as reviewed governance context, leaves notes out.
- **Branch scope.** Only `memoryKind: conversation_note` takes this path. Every other kind still needs a review that binds its exact summary, even when its review is a receipt.
- **v1 records notes for agent-to-agent turns only.** A turn an agent took because another agent mentioned it has a receipt. An owner's direct turn to a conversation's lead has none and writes no note.
- **Schema.** Notes and receipts need event schema 16 and 15. Writers record nothing until the repository's writer selects them.
- **Writers check before they append.** The projection refuses a note it cannot attest. It refuses by throwing, as for every context entry, so one bad note would fail the agent's whole context. A writer therefore projects the agent's context with the note and appends it only when the projection accepts it, through one storage handle with nothing awaited between the check and the append.

## Consequences

- An agent keeps memory from its conversations without a reviewer in the loop. The memory is labeled self-reported and expires in 30 days.
- The projection stays fail-closed, and a writer never appends a note the projection would refuse.
- Room records gain a reader, so `room.mention.recorded` derives its event ID from its mention.

## Verification

- `packages/agent-organization/test/agent-context-note.test.ts`: a note attested by its receipt is accepted, and a note may supersede another note. Each of these is refused:
  - a receipt for another agent, another conversation, or another mention, or after the promotion;
  - a note observed before its delivery;
  - a source that is not the receipt;
  - a receipt without a recorded mention;
  - an owner's mention, and an agent's mention of itself;
  - a note recorded before its mention or receipt, and a receipt recorded before its mention;
  - high confidence, another layer, restricted sensitivity, no expiry, an expiry past 30 days, or a summary over 2,048 bytes;
  - a subject whose topic is a word rather than the mention;
  - another kind with a receipt as its review;
  - a note whose review is no receipt;
  - a note that supersedes a verified work outcome, while the same records without the pointer stand;
  - a second note on the same receipt, even when it supersedes the first;
  - a handoff of a note.
- `apps/node-runtime/test/agent-context-document.test.ts`: the materialized agent context leaves a note out.
