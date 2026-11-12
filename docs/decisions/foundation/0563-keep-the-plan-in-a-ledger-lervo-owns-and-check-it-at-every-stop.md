# ADR-0563: Keep the plan in a ledger Lervo owns and check it at every stop

Status: `accepted`
Decision date: 2026-11-12
Amends: [ADR-0562 core loop](0562-one-relation-web-one-context-assembler-and-a-stop-ledger.md) (context assembler)
Related: [ADR-0561 decide without the owner](0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), [core loop roadmap](../../roadmap/core-loop.md)

## Context

On 2026-11-10 the owner observed that plans made at the start or in the middle of a conversation drop out, especially after the provider compacts it. The workstream on the Mac shows why. Its six next actions are long sentences an agent wrote by hand. Items the agent did not write down exist only in the conversation: the knowledge host CPU fix, the source-lineage cap, the Codex review, and the argo layout check. Notes are capped at nine, and 779 have been dropped. The title and references still describe a goal from months earlier. The last update was 2026-11-02, and Lervo itself marks it stale. After compaction the hook injects only the first next action. The provider writes the compaction summary, and Lervo never checks it against the plan.

On 2026-11-12 the owner described the wider pattern. An agent acts only on the item the owner named. It notices other open work only when the owner asks, and then it misses that work again later. In the same conversation, Lervo delivered health lines every turn (a knowledge stop of 10 days, 2 broken links), and no turn acted on them. The fact that the knowledge host CPU fix was still open came out only when the owner asked.

## Decision

Lervo, not the agent's memory, keeps the plan of a piece of work and checks it before a turn ends.

- **Capture from the transcript.** After each turn the resident host reads the new transcript records, the same pass that finds `used` in ADR-0562 section 4. It extracts three kinds of item: owner directives, plans the agent states (step lists and "next" commitments), and findings the turn marks for later repair. Each item records its source session and transcript position. Capture does not depend on the agent calling a command.
- **A tree, not a list.** Items form a tree: objective, pillar, step, and sub-item. No item is dropped for space. An item closes only as `done`, `cancelled` (the owner withdrew it), or `superseded` (another item replaces it), and the reason is recorded.
- **Done needs evidence.** An item becomes `done` only when Lervo observes its evidence: a commit reachable from the named branch, a passing test or check event, a published release, or a deployment record. A statement in the conversation is not enough.
- **Uncertain extraction is a candidate.** An item the extractor is not sure of is held as a candidate and confirmed by an independent cross-check (ADR-0561). The owner is never asked to review it.
- **Restore and compare after compaction.** When the ADR-0562 assembler starts a `compact` epoch, the base tier includes the open items of the ledger as one line each. Lervo compares the provider's summary with the ledger and names every open item the summary omitted.
- **Related items come to the agent first.** When a prompt or the changed paths touch a ledger item, the delta tier lists the open sibling items under the same parent, the earlier owner directives on the same paths, and the findings marked for later. The agent does not have to remember them or be asked again.
- **The turn cannot end with an item silently skipped.** The Stop hook compares the finished turn with the ledger. It checks every clause of this turn's owner message, every open item related to the touched paths or topic, every finding the agent itself stated as unfixed or deferred, and every health or attention line delivered in the turn. Each one must be acted on, with evidence, or deferred in the ledger with a reason. Otherwise the hook blocks the Stop and returns the list, so the agent continues in the same turn. Deterministic matching runs first; only an ambiguous match uses an independent cross-check. The hook blocks a turn at most twice. After that, the remainder is recorded as Lervo debt and named in the final reply.
- **Repeated misses escalate.** When the owner asks about an item Lervo already holds, or corrects a miss, Lervo records a `plan.item.missed` event against that item. Two misses of the same kind become an applied owner rule through instruction intake.
- **Drift at the end of a turn.** An owner directive with no item, or an open item untouched for a set number of turns, appears in the next delta as one line.
- **The workstream is a view.** The workstream objective, next actions, and blockers are generated from the ledger. Agents may still add items with `lervo workstream update`, which writes to the ledger.
- **One ledger on every host.** The ledger syncs through the Hub, so a session on another host or channel continues from the same items. It is the plan part of the continuation handoff.

## State, events, privacy, and failure meaning

- The plan ledger is durable state, not a projection, because provider transcripts can be rotated or deleted. Each item stores `{itemId, parentId, kind: directive|plan|finding, title, state: candidate|open|in_progress|done|cancelled|superseded, source: {provider, sessionId, transcriptOffset}, evidence?, closedReason?}`. The title is a short paraphrase. The ledger never stores prompt text or document bodies. New events are `plan.item.captured`, `plan.item.closed`, `plan.summary.gap` (an open item missing from a compaction summary), `plan.turn.blocked` (`{turnId, itemIds, attempt}`, emitted when the Stop hook blocks a turn), and `plan.item.missed` (`{itemId, cause: owner_asked|owner_corrected}`). A failed extraction records `plan_capture_failed` as Lervo debt and keeps the previous ledger; the next turn retries from the same transcript position.

## Consequences

- A plan survives compaction, a new session, and a change of host. Extraction can misread an item, so extracted items carry their source position, and an uncertain item stays a candidate until it is cross-checked.
- A turn can take longer, because the Stop hook sends the agent back to related items. The block limit keeps this bounded, and Lervo debt records anything left over.

## Verification

- Replaying the transcripts of the 2026-11-02 to 2026-11-10 core-loop conversation captures every item in the [core loop roadmap](../../roadmap/core-loop.md), including those absent from the workstream. After a compaction of that conversation, every open item is either in the provider summary or named as a gap. No item closes as `done` without recorded evidence. Replaying the same conversation's turns through the Stop check blocks the turns that left a related item untouched. Those include the turn of 2026-11-03 that reported the plan without saying the knowledge host CPU fix was still open, and every turn that left the delivered health lines unaddressed. Over the following weeks, the count of `plan.item.missed` events falls.
