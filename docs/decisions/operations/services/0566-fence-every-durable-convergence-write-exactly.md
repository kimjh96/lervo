# ADR-0566: Fence every durable convergence write exactly

Status: `accepted`
Decision date: 2026-11-15
Amends: [ADR-0461](0461-drive-resident-runtime-service-work-from-changes-not-timers.md) (which source checks guard effects)

## Context

Background knowledge convergence guards consequential effects with source fences: a complete capture of the repository compared with the snapshot a convergence state is bound to. Every fence was a complete capture, but they guarded different things. Some guarded a write; most only decided whether work was worth doing. Captures were 53.8 % of the Git processes in the slowest knowledge-runtime tests, so cheaper decision checks need a precise line between the two kinds.

Two adversarial reviews, each reproduced as failing tests, showed where the line was not yet drawn:

- Durable writes followed a decision check with no fence of their own: the provider observation and its usage event, normalization subset candidates, route classification records, private workspace writes, and the practice root applies. Each was safe only because every check happened to be a complete capture.
- Some exact fences were followed by unrelated awaits before their write: candidate resolution's listing, target preflight's ledger read and synchronization's own Git reads, and the capacity retirement's restore.
- The settled-output commit fenced the snapshot and then selected, formatted and staged after several awaits, so a file edited in between was committed unreviewed.

## Decision

- Every source check is **exact** or **current**. An exact fence is a complete capture taken now, with no unrelated await before the write it guards. A current check may later answer from a validated observation.
- Every durable write reachable between a current check and the next exact fence gets an exact fence immediately before it, unless no later step trusts it without checking its source binding again. The [source fence specification](../../../specs/background-knowledge-convergence/runtime/discovery-and-progress/resident-cycle/source-fences.md) holds the classification and the census of every such write.
- Functions that read Git after a fence and then move a ref take a fence callback and run it immediately before each ref write.
- The settled-output commit keeps `git add -A -- <paths>` and `git commit --only -- <paths>`. Every await of its selection, formatter lookup and formatting now runs first; then an exact fence accepts only the bound snapshot plus the formatter's own approved effects, immediately before `git add`. A refusal restores the formatted files.
- An exact fence proves that source bytes, HEAD and the changed-path set equal the bound snapshot. Refs other than HEAD, the index and Git config are outside it: every integration ref move is a compare-and-swap on its old value, and the settled-output commit is path-limited (`commit --only`).

Every check still captures in full; this decision changes no trust.

## Events, state and failure meaning

No new event or state. `source_bytes_changed` keeps its meaning. A settled-output commit whose staging fence refuses writes nothing to Git and restores the files it formatted.

## Verification

- `test/effect-fence-exact-sweep.test.ts` and `test/effect-fence-decision-sweep.test.ts` drive full convergences with a session that always answers "unchanged" and observe sources, refs, private state, content-store artifacts, checkpoints, private workspaces and events. Every edit must be refused by the very fence that saw it, and nothing durable may follow.
- `test/effect-fence-await-gaps.test.ts`, `test/knowledge-output-commit-fence.test.ts`, `test/document-route-classification.test.ts` and `test/practice-root-apply-fence.test.ts` edit inside each await between a check and a write. Each failed before this decision.
- `test/effect-fence-sweep-harness.test.ts` checks the sweep's own detection.

## Known pre-existing races

These windows existed before this decision and stay out of its scope:

- **Edit during staging.** An edit to a selected output after the staging fence, while `git add` and `git commit --only` read the working tree, is committed unreviewed. The window runs from the fence through the end of `git commit`.
- **Formatter over a developer edit.** The formatter reads, formats and writes each target file in turn. A developer edit to that file between the formatter's read and its write is overwritten, and a failed commit's restore writes the pre-format content back over any edit made after formatting.
- **Detached HEAD or branch switch.** `git checkout --detach` or a branch switch between the staging fence and `git commit` commits on whatever HEAD then names; the post-commit parent check returns an empty result but does not undo the commit.

## Consequences

Each full convergence runs more exact captures than before, because the newly fenced writes each take one.
