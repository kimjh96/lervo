# Plan ledger contract

This specification holds the item states, events, failure codes and privacy rules of [ADR-0563](../../decisions/foundation/0563-keep-the-plan-in-a-ledger-lervo-owns-and-check-it-at-every-stop.md). The plan ledger keeps the plan of a piece of work as a tree that Lervo owns, so the plan survives compaction, a new session and a change of host.

## Slices

| Slice | Scope                                                                                                                                                        | State   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| S1    | The ledger: item tree, evidence-only close, schema 9 events, `lervo plan`, and the open items in every turn's context.                                       | landed  |
| S2    | Capture: the owner-turn assessment of ADR-0467 also returns the work an exchange leaves open, and the resident writes it to the ledger.                      | landed  |
| S3    | Stop check: the Stop hook blocks a turn that leaves an owner clause, a related item, a stated finding or a delivered health line without action or deferral. | planned |
| S4    | Compaction comparison, missed-item escalation, drift lines, the workstream as a ledger view, and one ledger on every host through the Hub.                   | planned |

## Capture (S2)

The owner-turn assessment that already reads each owner turn and the preceding agent turn (ADR-0467) also returns `planItems`. One call does both, so capture adds no provider call.

- **What counts.**
  - A `directive` is work the owner asks for, including a task-scoped request that rule capture calls `none`.
  - A `plan` is a next step the agent committed to.
  - A `finding` is a defect or gap the agent stated as not fixed yet or deferred.
  - Questions, status requests, acknowledgements and finished work are not items.
- **What the assessment sees.**
  - At most 32 open items: in-progress first, then the most recently changed.
  - Each item appears as a short reference `p1` to `p32`, never as a ledger id (ADR-0604, ADR-0608).
  - It omits work these items already cover, and cites a parent by reference.
- **Once per turn.** Items are written from the attempt that settles the turn. A regenerated, retried or deferred attempt writes none, so repeated attempts never add paraphrases of the same work.
- **Confidence.** `high` confidence is `open`. Anything less certain is a `candidate`, which S3 confirms with an independent cross-check. At most 64 candidates stay open, and candidates never reach a turn's context.
- **Same work.**
  - An open item with the same parent and normalized title, from any source or of any kind, is the same work, and nothing new is written.
  - An explicit restatement confirms a candidate as `open`.
- **Privacy.**
  - A title the practice sanitizer would change, because it holds a secret, a credential or a home path, is dropped.
  - Plan context and plan items count outside the owner-rule capture budget, as practice does.
- **Isolation.**
  - The wire schema states only the shape. The parser drops an out-of-bounds item alone and keeps at most eight.
  - A value that is not a list records `planItemsFailure: invalid` and never fails rule capture.
  - Before schema 9 is active, nothing is written.

## Items and states

An item records `itemId`, `parentId`, `kind`, `title`, `state`, `source`, and, once closed, `reason`, `evidence` and `supersededBy`.

- **Kinds:**
  - `objective`: a goal that holds other items.
  - `directive`: an owner instruction.
  - `plan`: a step the agent committed to.
  - `finding`: a defect or gap marked for later repair.
- **Open states:**
  - `candidate`: captured but not yet confirmed.
  - `open`
  - `in_progress`
- **Closed states:**
  - `done`: needs evidence.
  - `cancelled`: the owner withdrew the item.
  - `superseded`: names the item that replaces it.

  A closed item never changes again.

- **Parents:** a missing parent places the item at the root. A parent cycle is broken at the earlier item.
- **Identity:** the id derives from the source, parent, kind and normalized title. Capturing an open item again returns it. Work that closed and comes back is a new item: the id chains from the closed one.
- **Moves:** a move under the item itself or one of its descendants is refused (`plan_item_invalid`).

## Evidence

An item closes as `done` only with evidence Lervo observes when the item closes. Lervo records the evidence exactly:

- `commit`: the commit exists and is reachable from the named branch, or from `HEAD` when no branch is named. It is stored as its full id, so a short id cannot become ambiguous later. A branch name must be a plain ref name.
- `release`: a tag of this repository.
- `event`: an event in this repository's event store, such as a check or deployment record. A plan ledger event is never evidence, so an item cannot prove itself.

A statement in the conversation is never evidence.

## Events

All events are schema 9. They wait for the writer activation of [event envelope compatibility](../execution/events-and-privacy/event-envelope-compatibility.md).

| Event                | Fields                                                                 | Meaning                                                 |
| -------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- |
| `plan.item.captured` | `itemId`, `parentId`, `kind`, `title`, `state`, `source`, `occurredAt` | A new item. A replay of an existing id changes nothing. |
| `plan.item.updated`  | `itemId`, `parentId`, `title`, `state`, `occurredAt`                   | An open item was retitled, moved or changed open state. |
| `plan.item.closed`   | `itemId`, `state`, `reason`, `evidence`, `supersededBy`, `occurredAt`  | The item closed. Later events never reopen it.          |
| `plan.summary.gap`   | `summaryDigest`, `itemIds`, `occurredAt`                               | S4: open items a compaction summary omitted.            |
| `plan.turn.blocked`  | `turnId`, `itemIds`, `attempt`, `occurredAt`                           | S3: the Stop hook sent a turn back, at most twice.      |
| `plan.item.missed`   | `itemId`, `cause` (`owner_asked`, `owner_corrected`), `occurredAt`     | S4: the owner had to raise an item Lervo already held.  |

ADR-0563 named five events. `plan.item.updated` was added so that a candidate can be confirmed and an item can be started or moved without being closed.

`source` records:

- `origin`: `transcript`, `agent_command` or `workstream`;
- `provider`;
- `sessionDigest`: the sha256 of the provider session id;
- `transcriptOffset`.

## Privacy

- A title or reason is one line of at most 240 characters, a short paraphrase.
- No event carries prompt text, a transcript excerpt, a document body or a raw session id.
- Evidence refs are commit ids, tags or event ids, never paths or free text.

## Failure codes

| Code                            | Meaning                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `plan_ledger_inactive`          | The writer has not selected schema 9; nothing was written.                            |
| `plan_item_invalid`             | A title, reason or superseding item is missing or out of bounds.                      |
| `plan_item_unknown`             | The item or parent does not exist.                                                    |
| `plan_item_closed`              | The item is already closed.                                                           |
| `plan_item_evidence_required`   | `done` was requested without evidence.                                                |
| `plan_item_evidence_unverified` | Lervo could not observe the commit, tag or event, or the commit is not on the branch. |

## Delivery

Each terminal turn receives the confirmed open items as optional context lines: a count, then at most six items with in-progress items first. Candidates stay out until S3 confirms them.

- Owner rules keep priority when the context budget is short.
- The plan lines come after the find pointers, the governance check and the learned notice. Those lines are short, and each counts as shown only once it is delivered. The plan is on every turn and one `lervo plan list` away.
- A ledger that cannot be read, such as before schema 9 is active, adds no lines and never fails a turn.

## Known limits of S1

- **Ledger read cost.** Every prompt folds all plan events again. The `events_type_seq` index keeps this cheap at today's sizes. A bounded snapshot of the fold is a follow-up before the ledger grows large.
- **No delivery telemetry.** No record says whether the plan lines reached a turn. S3 needs that record.
- **Rollback after activation.** A repository whose writer selected schema 9 cannot be opened by a CLI older than this release. A host rollback across the activation therefore needs the writer rolled back first (`lervo event-contract rollback`). This was already true when schema 8 was activated.
