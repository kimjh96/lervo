# Source fences

[ADR-0566](../../../../../decisions/operations/services/0566-fence-every-durable-convergence-write-exactly.md) defines these rules.

A source fence compares a complete capture of the repository with the snapshot a convergence state is bound to. A mismatch fails with `source_bytes_changed`. Each fence site is one of two kinds.

- **Exact** (`assertSourceExact`, `ConvergenceSourceObservation.exact`): a complete capture taken now. It guards a durable write, the settlement claim, or verification evidence. No unrelated await separates the fence from the first write it guards.
- **Current** (`assertSourceCurrent`, `ConvergenceSourceObservation.current`): a decision check. It decides whether work is worth doing, or binds a stage receipt that settlement fences again. A wrong "unchanged" answer can waste work, including a provider call, but it can never let a durable write through: the census below puts an exact fence before every write a later step trusts.

Both kinds are complete captures today. A context without a `sourceObservation` captures every time. After its own repository effect, a stage calls `noteChange()`, so a later current check observes the repository again.

## What an exact fence proves

The snapshot hash binds HEAD, the policy hash, the path, content hash and kind of every captured source, and the changed-path set (`diff HEAD` names plus untracked sources). An exact fence therefore proves that source bytes, HEAD and the changed-path set equal the state's snapshot. It does not cover refs other than HEAD, the index, Git config, or ignore rules that match no current file.

No effect depends on those:

- **Refs other than HEAD.** Every integration ref move is a compare-and-swap on the exact old value: target synchronization and absorption (`update-ref <ref> <new> <old>`), integration completion (`compareAndSwapTarget`), capacity retirement (which also rereads the ref before and after), and target creation (an empty old value). A concurrent ref change makes the move fail instead of acting on a stale ref.
- **The index.** The settled-output commit runs `git add -A -- <paths>` and `git commit --only -- <paths>`, so the commit holds HEAD plus the working-tree bytes of the files those pathspecs match; staged work on other paths never enters it, but a path with glob characters can match more files (see the known races below) (`knowledge-output-commit.test.ts`). An exact fence runs immediately before `git add`, after every await of selection and formatting, and accepts only the bound snapshot plus the formatter's approved effects. Seals commit in private worktrees. Root applies write working-tree files with a per-operation expected hash.
- **Git config.** Config is the repository's own policy, and Lervo's settled-output commits apply it as a developer's commit would, hooks and filters included. The private seal commit disables hooks.

## Known pre-existing races

These windows predate the exact and current split and stay out of its scope; [ADR-0566](../../../../../decisions/operations/services/0566-fence-every-durable-convergence-write-exactly.md) records them:

- **Edit during staging.** An edit to a selected output after the staging fence, while `git add` and `git commit --only` read the working tree, is committed unreviewed. The window runs from the fence through the end of `git commit`.
- **Formatter over a developer edit.** The formatter reads, formats and writes each target file in turn; a developer edit between that read and write is overwritten. If `git add` or `git commit` then fails, the restore writes the pre-format content back over any edit made after formatting. A staging fence refusal restores a formatted file only while it still holds the formatter's bytes, so an edit or deletion made after formatting stays.
- **Glob pathspecs.** `git add -A -- <paths>` and `git commit --only -- <paths>` read each path as a pathspec, so a selected `x[A].md` also matches `xA.md` and can stage and commit it. Follow-up: run both calls with `GIT_LITERAL_PATHSPECS=1` and test a selected path that contains glob characters next to a file it would match.
- **Detached HEAD or branch switch.** `git checkout --detach` or a branch switch between the staging fence and `git commit` commits on whatever HEAD then names; the post-commit parent check returns an empty result but does not undo the commit.

## Classification

| Site                                                                                     | Kind    | Guards                                                    |
| ---------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------- |
| Host settlement (`assertSettlement`)                                                     | Exact   | The durable claim, inside the event lock                  |
| Settled output commit (`settled-output-boundary.ts`), at the boundary and before staging | Exact   | The knowledge commit                                      |
| Seal start, each private deletion, link and draft, the seal plan                         | Exact   | Private workspace writes, its commit and the seal plan    |
| Seal application                                                                         | Exact   | The seal                                                  |
| Integration candidate and completion                                                     | Exact   | The candidate apply and the integration ref move          |
| Root apply (`canonical-integration-effect.ts`)                                           | Exact   | Working-tree writes                                       |
| Provider result (`provider-call.ts`, after the call)                                     | Exact   | The observation artifact, usage event and review cache    |
| Normalization subset, after an approval or a timed-out review                            | Exact   | The smaller candidate in the candidate store              |
| Document route classification                                                            | Exact   | Classification records                                    |
| Normalization generation and apply                                                       | Exact   | Candidate storage and working-tree writes                 |
| Lifecycle prefix and ordered lifecycle apply                                             | Exact   | Working-tree writes                                       |
| Lifecycle asset settlement (`lifecycle-final.ts`)                                        | Exact   | The asset settlement record                               |
| Candidate resolution                                                                     | Exact   | Candidate transitions                                     |
| Capacity ref retirement (`canonical-integration-stage.ts`)                               | Exact   | The restoring ref commit                                  |
| Target preflight, before synchronization                                                 | Exact   | Integration ref synchronization, absorption or restore    |
| Practice retirement and materialization root apply                                       | Exact   | Root deletion or write, its commit and the practice event |
| Stage verification observation                                                           | Exact   | Verification evidence                                     |
| Host `prepareStage`, both `assertCurrent` checks, `runStage`                             | Current | Whether a stage runs; settlement fences its result        |
| Stage receipt                                                                            | Current | The receipt binding, fenced by settlement                 |
| Provider checks before and during the call                                               | Current | Whether a provider call starts or continues               |
| Target preflight result, retained integration inspection                                 | Current | Parking and retirement decisions; their effects fence     |
| Lifecycle currency pair, assessment sources after a lifecycle apply                      | Current | Stable inputs for currency and lint; settlement fences    |

Two sites read before their fence so that no await separates the fence from the write: target preflight reads the integrated-draft ledger, and candidate resolution lists the stored candidates. Integration target synchronization, absorption and the capacity retirement's restore run their own Git reads, so an exact fence runs again immediately before each of their ref writes.

## Durable write census

Every durable write reachable between a current check and the next exact fence is either fenced or exempt. A write is exempt only when no later step trusts it without checking its source binding again.

| Write                                                                                                                                                     | Treatment                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Settlement of a `current` stage result, and the terminal convergence record                                                                               | Exact: settlement                                                                                                                 |
| Waiting, attention and stale stage records; stage failure proofs                                                                                          | Exempt: they claim no currency, and `dependencyCurrent` compares their snapshot with the discovered baseline before trusting them |
| Stage receipts and result inputs (CAS)                                                                                                                    | Exempt: content-addressed; only a state that settlement fences names them                                                         |
| Provider admission leases and budget reservations                                                                                                         | Exempt: spend accounting for a call that happens whatever the bytes are; it never authorizes an effect                            |
| Provider observation artifact, `resource.usage.recorded`, provider review cache                                                                           | Exact after the provider call. The cache key also binds the snapshot hash and every input                                         |
| Normalization review cost record                                                                                                                          | Exempt: telemetry that sizes later batches                                                                                        |
| Normalization subset candidates                                                                                                                           | Exact                                                                                                                             |
| Document route classification records                                                                                                                     | Exact                                                                                                                             |
| Lifecycle plan review evidence (CAS)                                                                                                                      | Exempt: content-addressed; the lifecycle prefix apply that uses it is exact                                                       |
| Assignment and lease events                                                                                                                               | Exempt: coordination; every effect under an assignment is fenced again                                                            |
| Private workspace provision: a detached worktree at a commit, its marker and workspace record                                                             | Exempt: it reads no working-tree source, and every write into it and every use of it is fenced                                    |
| Private workspace deletions, links, drafts and commit; the seal plan checkpoint                                                                           | Exact                                                                                                                             |
| Workspace verification evidence                                                                                                                           | Exempt: it binds the private workspace's own revision, not the repository's sources                                               |
| Integration plan checkpoint                                                                                                                               | Exempt: a private plan; the candidate apply that uses it is exact                                                                 |
| Seal, candidate, completion, root apply, normalization, lifecycle, transitions, retirement, refs                                                          | Exact                                                                                                                             |
| Practice retirement and materialization root writes, commits and events                                                                                   | Exact                                                                                                                             |
| Resident bookkeeping: worker lock, maintenance, retention, freshness and staleness readings, provider CLI detection, requeue cursor, terminal skill usage | Exempt: outside every obligation and rebuildable; none authorizes a convergence effect                                            |
| Document freshness cycle records                                                                                                                          | Exempt: freshness never uses the convergence session and fences its own effects                                                   |

## Evidence that exact fences alone protect durable writes

A test session whose validation always answers "unchanged" drives full convergences. Its answer is fixed before any edit, even on the first call and right after `noteChange()`, so it never notices another writer. Exact captures stay real. `test/durable-effect-state.ts` observes HEAD, every ref, every source but the edited one, every file under `.lervo/state/` that the census does not exempt, every artifact in `.lervo/data/cas/` except the census-exempt kinds (stage receipts, stage results, convergence inputs, stage and assignment failure proofs, waiting dependencies), effect checkpoints, each private workspace's HEAD and files, and the event store. Every `source_bytes_changed` refusal is recorded with the stack that raised it, so each edit is credited only to the exact fence that refused it, never to a later decision check.

- `test/effect-fence-exact-sweep.test.ts` edits just before the first exact fence at each site. That fence must refuse with `source_bytes_changed`, and no durable state may change and no unexempt event may be appended before the next observation. Verification evidence refuses through its stage receipt.
- `test/effect-fence-decision-sweep.test.ts` edits at the first decision check of each site. Until the next exact fence, no durable state may change and no event outside the census exemptions may be appended. That fence must refuse.
- `test/effect-fence-sweep-harness.test.ts` checks the sweep itself: it sees content-store artifacts, events after a refusal, and a decision check refusing in place of an exact fence. An edit whose stage ends in a waiting or attention record reaches no further fence; the sweep checks that it wrote nothing durable.
- `test/effect-fence-await-gaps.test.ts` edits inside the awaits a sweep cannot reach: after a provider answer, after a normalization review or a timed-out one, while target preflight reads its ledger, during integration target synchronization's own reads, and while candidate resolution lists candidates. Every later durable write must follow an exact fence that saw the edit. `test/knowledge-output-commit-fence.test.ts` edits a selected output during each await between the boundary fence and the staging fence (commit grant, ledger, formatter lookup, formatting); the staging fence must refuse, so that commit never holds the edit.
- `test/document-route-classification.test.ts`, `test/practice-root-apply-fence.test.ts` and `test/canonical-layout-parking.test.ts` cover classification records, practice retirement and capacity retirement, which no full scenario reaches.
