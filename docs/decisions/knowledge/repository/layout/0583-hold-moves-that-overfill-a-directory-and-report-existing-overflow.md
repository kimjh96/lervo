# ADR-0583: Hold moves that overfill a directory and report existing overflow

Status: `accepted`
Decision date: 2026-11-18
Amends: [ADR-0222](../0222-bounded-role-based-document-layout.md) (capacity evaluation), [ADR-0547](0547-block-only-layout-overflow-a-write-creates-or-grows.md) (existing overflow)

## Context

[ADR-0222](../0222-bounded-role-based-document-layout.md) limits how many documents a directory holds and how many document-bearing child directories it has. The default limit is 32 for each. [ADR-0547](0547-block-only-layout-overflow-a-write-creates-or-grows.md) stopped existing overflow from blocking writes elsewhere. A capacity blocker now blocks only when the operations make the count larger.

The `argo` repository still stayed `blocked` with `document_directory_file_capacity_exceeded` on every release. Its user note folders exceed the limit: `v8/notes` holds 184 documents, `v6/notes` 88, `collector/notes` 44, and `v7/notes` 37. The report named no directory, so these folders looked like the cause.

A read-only plan of a copy of `argo` showed the real cause. The repository layout migration routed 33 review notes from `v6/notes` into `docs/quality`, a directory that did not exist. The plan's own permit then refused that layout (0 observed, 33 projected, limit 32). The planner threw, and the whole knowledge stage failed. The user folders were never the blocker.

Two smaller gaps remained:

- A plan that moves one document into an over-limit directory and deletes another keeps the count equal, so ADR-0547 did not block it. It still adds a new document to a full directory.
- The evaluation listed untouched overflow in `blockers` although it never blocked. Lint reported that overflow as an error, so user-owned folders looked like a Lervo failure.

## Decision

### A capacity finding blocks only what the operations add

The evaluator reports a capacity finding for each directory whose projected count exceeds its limit. The finding blocks when either condition holds:

- The projected count exceeds `max(limit, observed)`.
- An operation moves or creates a document in that directory, or a new document-bearing child under it, that the snapshot did not have there.

A rename inside one directory does not count as moving a document in. Its source and destination share a parent, so the directory keeps the same documents under a new name. `lervo knowledge structure move` can therefore still rename a note inside an over-limit folder such as `v8/notes`, as ADR-0547 allowed.

Every other finding is an advisory. `DocumentLayoutEvaluation.blockers` now holds only blocking findings, and `advisories` holds the rest. An evaluation is `blocked` exactly when `blockers` is not empty. The same rule covers `document_directory_file_capacity_exceeded` and `document_directory_child_capacity_exceeded`. Repository capacity keeps the ADR-0547 rule, because the repository has no separate place to move into. `worseningDocumentLayoutBlockers` is removed; its callers read `blockers` directly.

### Layout migration holds the moves that would overfill a directory

The repository layout planner evaluates its candidate moves against the current layout before it builds operations. If moves would overfill a destination directory, the planner holds every move into that directory. It repeats the check until no move overfills a directory. Each held source stays where the owner put it and appears as a deferred document with reason and resolution `destination_capacity` and its `destination`. A held move is not a plan blocker, so the remaining moves still form the layout decision.

A rename inside one directory is never held, because it cannot overfill that directory. The plan reports `layoutCapacity`, one entry per directory and code over the limit. Each entry carries `code`, `directory`, `observed`, `projected`, `limit`, and a `disposition`. `moves_held` means the plan held moves into that directory. `existing_overflow` means the plan leaves the user's overflow as it is.

### Reports name the directory, counts, and limit

- A blocked permit's message reads, for example, `blocked by document_directory_file_capacity_exceeded in docs/quality (observed 0, projected 33, limit 32)`. `lervo upgrade` and `lervo migrate knowledge` carry this message in text and JSON.
- `lervo upgrade` adds `stages.knowledge.layoutCapacity`, at most 16 entries, and `stages.knowledge.layoutCapacityCount`, the full number. Its text prints the full number and one line per listed directory under the knowledge stage.
- `lervo migrate knowledge` prints the same lines with a repository layout plan, and its JSON includes `layoutCapacity`.
- `lervo knowledge lint` reports existing overflow as a `warning` with the same details. It no longer reports it as an `error`.

## Consumers checked

- `canonicalDocumentLayout` and `capacityBlocked` in `repository-knowledge-runtime` park a convergence batch only on blocking findings. Under this rule they no longer park a batch that leaves existing overflow alone, and they still park a batch that adds to it.
- `knowledgeConvergenceFailureCode` only classifies thrown codes. The codes are unchanged.
- Durable apply validates the permit by evaluating again with the same rule, so a permit and its check agree.
- The upgrade knowledge stage copies the thrown code and message. It now also copies the layout plan's `layoutCapacity`.

## Follow-up

The capacity hold covers only document moves. The layout planner also writes structural outputs, instruction bridges, and machine-artifact moves, and it does not check those writes before it authorizes the plan. If those writes alone overfill a directory, the planner still fails with a capacity blocker, as it did before this decision. Holding or deferring those writes the same way is a bounded follow-up in `repository-layout-migration.ts`. Its verification is a planner test in which generated writes overfill a directory and the plan returns instead of throwing.

## State, events, privacy, and failure meaning

- No event is added. `DocumentLayoutEvaluation` gains `advisories`. `RepositoryLayoutMigrationPlan` gains the optional `layoutCapacity`. The upgrade knowledge stage gains the optional `layoutCapacity`.
- `DocumentRouteDeferralReason` and `DocumentRouteDeferralResolution` gain `destination_capacity`. It means the move is held and the source is unchanged. The owner resolves it with a capacity override in `.lervo/knowledge/document-layout.yaml` or a route in front matter.
- Directory paths and counts appear only in owner-local plan and lint output, where document paths already appear.
- A capacity blocker still fails a write that adds to a full directory. It never fails a plan for overflow the plan leaves alone.

## Verification

- `packages/documents/test/document-layout.test.ts` shows that untouched overflow is an advisory, that growth blocks, that an equal-count move or create into an over-limit directory blocks, that the same holds for child directories, and that a rename inside an over-limit directory is permitted.
- `packages/repository-knowledge/test/repository-layout-capacity.test.ts` shows that the planner keeps a rename inside an over-limit directory, holds a move into it, and reports that directory once.
- `packages/repository-knowledge/test/document-layout-enforcement.test.ts` shows a write beside a 33-document user folder is permitted, and that adding to it fails with the directory, counts, and limit in the message.
- `packages/repository-knowledge/test/repository-layout-migration.test.ts` shows that 33 moves into one route are held as `destination_capacity`, other moves remain, and `layoutCapacity` reports both dispositions.
- `apps/cli/test/upgrade-layout-capacity.test.ts` shows the upgrade knowledge stage and both text reports carry the details.
- A read-only plan of a copy of `argo` with this build changed the knowledge stage from `blocked` to `pending_authority` (`layout_decision_pending`). It proposes 19 moves into `docs/architecture` and `docs/data`, holds the 33 moves into `docs/quality`, and lists the four note folders as existing overflow.
