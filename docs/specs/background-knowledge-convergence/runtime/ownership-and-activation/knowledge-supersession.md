# Knowledge supersession

[ADR-0468](../../../../decisions/coordination/sync/0468-propagate-knowledge-supersession-across-replicated-checkouts.md) makes the owner's [publication supersession](cross-host-ownership.md#publication) hold on every replicated checkout. This page lists the commands and guards.

## Recording

When a replay conflict supersedes the selected commits, the owner first appends them to `.lervo/state/knowledge/knowledge-supersession.json`. It computes patch ids with `git diff-tree --stdin -p` piped to `git patch-id --stable`, and records the observed remote base as each entry's `base`. Recording happens before the pull request state or the local branch changes, so a failed reset never loses the record.

## Reconciliation

One reconciliation merges incoming entries into the checkout's ledger and drops superseded commits at the tip of its checked-out branch:

| Step    | Command                                                                                     | Guard                                                                                         |
| ------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Inspect | `git log --first-parent --max-count=64 HEAD`                                                | Only the leading non-merge commits whose author and committer are `knowledge@lervo.invalid`   |
| Match   | `git patch-id --stable`, `git merge-base --is-ancestor <base> <commit>`                     | Id in the ledger, or a matching patch on a commit that does not descend from the entry's base |
| Back up | `git update-ref refs/lervo/knowledge-superseded/<first 12 hex of HEAD>`                     | The eight newest backup refs are kept                                                         |
| Refresh | `git update-index -q --refresh`                                                             | Rehashes stat data that a replica apply discarded; changes no content                         |
| Drop    | `git reset --keep <parent of the superseded run>`                                           | On a branch, still at the inspected head, with no merge, rebase, cherry-pick, or index lock   |
| Hold    | `git rev-list --ignore-missing --no-walk --stdin`, then `git rev-list --stdin` with `^HEAD` | Ledger commits still reachable from `HEAD` are reported as held                               |

An empty ledger runs no Git command. The ledger is rewritten only when its entries, held state, or last drop change.

## Replica cycle

The coordinator runs the exchange after observing both snapshots and before any decision:

1. The local checkout reconciles with no incoming entries.
2. The peer runs `repository-replica knowledge-supersession --root <root>` with the local entries as `{"entries": [...]}` on stdin and prints its reconciliation as JSON. A local peer calls the same function in process.
3. If the peer knew entries the local side lacked, the local checkout reconciles again with them.
4. If the two held sets differ, the cycle fails with `repository_replica_superseded_knowledge_held` at stage `supersession`. The local receipt records it, and no history moves.
5. If any commit was dropped, both snapshots are observed again before the push, pull, or merge decision.

A merge whose result equals the peer's snapshot reports `pulled`. This covers the fast-forward after the local side dropped commits the peer had already left behind.

## Owner publication

`publishKnowledgeOutputs` reconciles the owner's own ledger after the ownership check and before its inventory. A failed reconciliation does not block publication. Ledger commit ids join `supersededCommits` in the exclusion set, so no ledger commit is ever selected.

## Attention

A checkout whose ledger has `held` shows one `knowledge_publication` item with failure code `knowledge_supersession_held` and detail `<count> superseded commit(s) held: <reason>`. The remediation depends on the reason:

| Reason              | Remediation                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `under_other_work`  | Rebase the branch onto the remote base and drop the `knowledge@lervo.invalid` commits listed below your own work |
| `not_on_branch`     | Finish or abort the Git operation and check out the branch                                                       |
| `worktree_conflict` | Commit or stash the uncommitted edits that touch the superseded commits' paths                                   |

The next replica cycle or publication drops the commits once the condition clears, and the item disappears.
