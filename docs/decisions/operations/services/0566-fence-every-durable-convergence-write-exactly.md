# ADR-0566: Fence every durable convergence write exactly

Status: `accepted`
Decision date: 2026-11-15
Amends: [ADR-0450](../../knowledge/repository/canonicalization/0450-keep-background-knowledge-out-of-developer-flow.md) (how settled outputs are committed), [ADR-0461](0461-drive-resident-runtime-service-work-from-changes-not-timers.md) (which source checks guard effects)

## Context

Background knowledge convergence guards consequential effects with source fences: a complete capture of the repository compared with the snapshot a convergence state is bound to. Every fence was a complete capture, but they guarded different things. Some guarded a write; most only decided whether work was worth doing. Captures were 53.8 % of the Git processes in the slowest knowledge-runtime tests, so cheaper decision checks need a precise line between the two kinds.

Two adversarial reviews, each reproduced as failing tests, showed where the line was not yet drawn:

- Durable writes followed a decision check with no fence of their own: the provider observation and its usage event, normalization subset candidates, route classification records, private workspace writes, and the practice root applies. Each was safe only because every check happened to be a complete capture.
- Some exact fences were followed by unrelated awaits before their write: candidate resolution's listing, target preflight's ledger read and synchronization's own Git reads, and the capacity retirement's restore.
- The settled-output commit fenced the snapshot and then committed with `git add` and `git commit --only`, which read the working tree again after several awaits. A file edited in between was committed unreviewed, and a later receipt refusal could not undo the commit.

## Decision

- Every source check is **exact** or **current**. An exact fence is a complete capture taken now, with no unrelated await before the write it guards. A current check may later answer from a validated observation.
- Every durable write reachable between a current check and the next exact fence gets an exact fence immediately before it, unless no later step trusts it without checking its source binding again. The [source fence specification](../../../specs/background-knowledge-convergence/runtime/discovery-and-progress/resident-cycle/source-fences.md) holds the classification and the census of every such write.
- Functions that read Git after a fence and then move a ref take a fence callback and run it immediately before each ref write.
- The settled-output commit records exactly the fenced bytes. After every await, each selected path is checked against the fenced snapshot by content hash and kept in memory, with the file type and executable bit read right after the fence. Blobs are written from memory without filters, the tree is built in a private index from the fenced HEAD, and `commit-tree` records it. Holding the developer's `index.lock` exclusively, the helper gives way to any operation in progress, updates the developer's index only where its entry still equals the fenced HEAD's, and moves HEAD by compare-and-swap under Lervo's identity. No hook runs; `commit.gpgsign` is honoured, and an invalid value or a signing failure gives way. An edit made after the fence stays in the working tree, uncommitted, and staged work stays staged.
- An exact fence proves that source bytes, HEAD and the changed-path set equal the bound snapshot. Refs other than HEAD, the index and Git config are outside it: every ref move is a compare-and-swap on its old value, and no effect commits through the developer's index or applies config filters to reviewed bytes.

Every check still captures in full; this decision changes no trust.

## Events, state and failure meaning

No new event or state. `source_bytes_changed` keeps its meaning. A settled-output commit whose bytes no longer match refuses with it before any Git write, and restores the files it formatted.

## Verification

- `test/effect-fence-exact-sweep.test.ts` and `test/effect-fence-decision-sweep.test.ts` drive full convergences with a session that always answers "unchanged" and observe sources, refs, private state, content-store artifacts, checkpoints, private workspaces and events. Every edit must be refused by the very fence that saw it, and nothing durable may follow.
- `test/effect-fence-await-gaps.test.ts`, `test/knowledge-output-commit-fence.test.ts`, `test/document-route-classification.test.ts` and `test/practice-root-apply-fence.test.ts` edit inside each await between a check and a write. Each failed before this decision.
- `test/knowledge-output-exact-commit.test.ts` compares the commit with the former `git add` and `git commit --only` for merges, cherry-picks, a held index lock, an invalid signing setting, file modes and the reflog identity, and checks that staged work survives.
- `test/effect-fence-sweep-harness.test.ts` checks the sweep's own detection.

## Consequences

Hooks no longer run for settled-output commits, as they already did not for private seal commits. Each full convergence runs more exact captures than before, because the newly fenced writes each take one.
