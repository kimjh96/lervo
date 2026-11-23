# ADR-0547: Block only layout overflow a write creates or grows

Status: `accepted`
Decision date: 2026-11-01
Amended by: [ADR-0583](0583-hold-moves-that-overfill-a-directory-and-report-existing-overflow.md). Untouched overflow moves from `blockers` to `advisories` and lint reports it as a warning; a move or create into an over-limit directory blocks at an equal count. [ADR-0589](../../../distribution/0589-shorten-the-follower-path-from-publication-to-the-last-repository.md): an upgrade apply that applied no stage before lint, and whose knowledge stage is current with no background debt, skips lint.
Amends: [ADR-0620](../0620-bounded-role-based-document-layout.md) (layout permits), [ADR-0214](../../../operations/services/0214-bounded-repository-upgrade-orchestration.md) (stage dependencies)

## Context

[ADR-0620](../0620-bounded-role-based-document-layout.md) evaluates the projected document layout before every document write. The evaluator reported a capacity blocker whenever a projected count exceeded its limit. The count did not have to grow. A permit required no blockers at all.

The `argo` repository has 86 notes in one directory, against a limit of 32. These notes existed before enforcement. As a result, every Lervo document write in `argo` was refused, even generated knowledge files in other directories. `lervo upgrade` reported the knowledge stage `blocked` with `document_directory_file_capacity_exceeded`.

[ADR-0214](../../../operations/services/0214-bounded-repository-upgrade-orchestration.md) made the Node stage depend on knowledge being `not_blocked`. The `argo` Node runtime therefore stayed on 0.22.4. The event writer stage waits for the Node to read the new schema, so it stayed blocked too. One old directory froze the knowledge, Node, and event writer stages.

Node readiness judges regression, not knowledge currency: every component must be healthy or keep the exact non-ready state it had before. Knowledge currency was never a Node readiness input. The dependency came from the earlier serial upgrade flow.

## Decision

### Existing overflow is debt, not a write barrier

A capacity blocker blocks a write only when the operations make that count larger than observed (`projected > observed`). This includes crossing the limit. Overflow the operations leave unchanged or reduce is existing debt:

- The evaluation still lists it in `blockers`, so lint keeps reporting it as an error.
- It does not make the evaluation `blocked`, and it does not prevent a permit.
- Role conflicts always block.

`worseningDocumentLayoutBlockers` is the one shared filter. Permit creation, permit validation at apply, `authorizeCurrentRepositoryDocumentLayout`, and canonical convergence parking all use it. A write that adds a document to a full directory still fails during planning.

### Node is ordered after knowledge, not gated by it

The Node stage requires `ordered_after` knowledge. It still applies after knowledge in the same run, but a blocked or pending knowledge stage no longer defers it. Lint runs after the Node stage on every apply and reports a blocked knowledge stage instead of being skipped. Lint failure to produce a report still fails the command.

## State, events, privacy, and failure meaning

- `UpgradeStageRequirement` gains `ordered_after`. No event is added.
- An evaluation can be `bounded` while `blockers` lists existing debt. Only a worsening blocker means the projected layout is not permitted.
- `knowledge_stage_blocked` no longer appears as a Node or lint skip reason.

## Verification

- `packages/documents/test/document-layout.test.ts` shows that an unrelated create, an in-place update, and a deletion in an overflowing directory are permitted, and that adding to it is blocked.
- `apps/cli/test/upgrade-stage-policy.test.ts` and `upgrade-independent-stages.test.ts` show the Node stage and lint proceeding while knowledge is blocked.
- A read-only `lervo upgrade` plan of `argo` with this build changes from `blocked` to `ready`, with `knowledge` and `node` applicable.
