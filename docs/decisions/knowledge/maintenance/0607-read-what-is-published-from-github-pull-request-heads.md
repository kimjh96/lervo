# ADR-0607: Read what is published from GitHub's pull request heads

Status: `accepted`
Decision date: 2026-11-21
Amends: [ADR-0603](0603-derive-knowledge-publication-from-repository-policy-and-judge-it-by-content.md) (how published commits are recognized)
Related: [ADR-0602](0602-wait-on-change-tokens-and-guard-idle-timers.md), [ADR-0466](../../coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md)

## Context

ADR-0603 first kept a local ledger of the commits merged publications carried, and then a record in each pull request body. Review found the classes behind both:

- A local ledger differs on another host and after lost state, needs a count cap, and misses a merge GitHub reports before its merge commit.
- A body record can be edited after the fact. A forged `Lervo-Publication-Commit` line made a local commit count as published, and the `reset --keep` catch-up could then drop it.
- gh resolved `{owner}/{repo}` from its own default repository, not from the configured remote, and `gh pr list --head` matches a branch name in any fork.
- GitHub closes a pull request whose head branch a person deleted; that closure was read as a decision about its commits.

## Decision

### GitHub is the source of truth for what is published

A local record of what merged breaks on another host, after lost state, beyond any count cap, and when GitHub reports a merge before its merge commit. A record in a pull request body can also be edited. So the answer comes from what GitHub itself holds:

- On every cycle that asks GitHub, Lervo reads the publication branch's pull requests, paginated. A local knowledge commit is published when its zero-context patch id is among the commits a merged pull request carried. The commits are read from GitHub's own `refs/pull/<n>/head`, in `merge-base(base, head)..head`. For a merge commit, the fork point comes from the merge commit's first parent. A pull request reopened since leaves the closed history until it closes again.
- No clock decides it. A local commit C counts for merged pull request n only when n's merge commit M is not an ancestor of C's parent, checked with `git merge-base --is-ancestor M C^`. A commit built on the merge came after it: an identical change Lervo regenerates after a person reverted the merge is new work and is published again, at once and whatever its author date. When M is not in this checkout, the commit stays published, which is the safe side. Git is asked once per merge commit, commit parent and pair, however many pull requests carried the same patch.
- A replay onto a moved base keeps its zero-context patch id, so a squash, a rebase or a merge commit counts the same. A commit a person's force-push removed, or one a forged or edited record claims, was never in the head and never counts. The `reset --keep` catch-up therefore cannot drop it.
- Pull requests merged before records existed are backfilled the same way, so no content fallback remains. The oldest-prefix-by-bytes heuristic is gone.
- Each settled pull request is fetched once: its patch ids are cached by pull request number and head, so one closed again at a new head is read again. A head GitHub does not serve is fetched again on its own, so one missing ref never fails the rest. A merged pull request whose head stays unavailable fails the step with `knowledge_publication_pull_head_unavailable`, naming `refs/pull/<n>/head`; it is retried after 2 minutes, doubling to an hour, then stays attention, and nothing is published until it can be proven. A closed one a person closed still holds back what its record names, which can only withhold commits, never publish them.
- The history is read newest change first and incrementally: only pull requests GitHub changed since the last change seen, less ten minutes. The pull requests and their patch ids are cached per repository, so a new host key keeps them. The cache stays within 16 MB: the oldest pull requests' patch ids are dropped first, since they can be fetched again, and a history that still does not fit is read whole each cycle and reported as `knowledge_publication_history_uncached`.
- Local patch ids are streamed through `git patch-id` in batches of 256 commits, so a large backlog needs no large buffer. A failure there is `knowledge_publication_inspect_failed`. A merge GitHub reports as `MERGED` counts as soon as its head is read, even before it reports the merge commit, and it is read again until it does.
- There is no cap. The 64-commit limit of one pull request applies only to what is pushed, never to what is matched.
- Each pull request body still ends with an HTML comment that records the pushed head and the commits it carries (`Lervo-Publication-Head`, `Lervo-Publication-Commit`). The body is updated before any merge, and a failed update fails the step. The record is for people and for Lervo's own closure mark; it never makes a commit published.
- The local `knowledge-publication-history.json` keeps the repository's history and, separately, the derived set for one host, base and head. Only cycles that ask nothing read it, any cycle that asks GitHub rebuilds it, and every publication re-keys it to where the local branch ended up. A missing, invalid or foreign cache costs one GitHub read.

A knowledge commit is upstream when its patch is in the base or a merged pull request carried it. After a merge, the local base resets with `reset --keep` when no work can be lost: every local-only commit is published, or is a non-merge commit whose paths hold the same bytes on both sides. A Git error there is an error, never bytes that differ.

### Every gh call targets the publication remote's repository

gh resolves `{owner}/{repo}` from its own default repository, which in a fork clone, a checkout with several remotes, or behind an SSH host alias can be another repository. Lervo reads the host, owner and name from the URL of `publication.remote`, on github.com or a GitHub Enterprise Server host. An SSH host is resolved with `ssh -G --`, within five seconds, which reads the SSH configuration and connects to nothing. `ssh.github.com`, GitHub's endpoint on port 443, is github.com, also when `ssh -G` fails and the remote names it directly, as in `ssh.github.com:owner/repo`. Any other resolved host, an IP address included, counts only when `gh auth status --hostname` knows it; otherwise the alias is kept as written, and gh refuses it visibly. That answer is provisional, since gh may only be offline or logged out for a while: the forge uses it for five minutes and then resolves the repository again, and a failed resolution is tried again on the next call. A settled answer is kept. A remote that names no repository refuses by name. Every `gh api` endpoint and field gets that owner and name filled in, with `--hostname` off github.com, because `gh api` has no `--repo`; every other gh command gets `--repo HOST/OWNER/NAME`. `gh pr list --head` matches a branch name in any fork, so only a pull request whose head is in the same repository counts.

### The owner's decisions on GitHub are kept

- **Closed without merge:** a pull request a person closed is a decision. Lervo does not reopen it or publish its commits again, and reports `knowledge_publication_declined`. Before Lervo closes a pull request itself, for supersession or a rerun, it marks the record `Lervo-Publication-Closed`, so its own closures are never read as decisions.
- **Branch deleted:** GitHub also closes a pull request whose head branch was deleted. That is no decision about its commits. A close at most one minute after a `head_ref_deleted` event in the pull request's issue events is read this way, and the commits are published again. A person who closes it and then deletes the branch decided first, so that close stays a decision.
- **Changed on the base:** the newest merged publication is compared with its merge commit, on the paths that merge landed. A revert or a person's edit of a Lervo output is `knowledge_publication_base_changed` and is never republished. The publisher's formatting commit, a squash, a rebase, and edits of other paths are not changes.
- `lervo knowledge convergence owner acknowledge` ends both kinds of attention. A base change returns when those paths change again, and a decline returns when another pull request is closed. Acknowledgements live in their own file, which only that command writes.

## Consequences

- Any host derives the same published set from GitHub alone; no local state, ledger, cap or body text can make a commit published.
- Each settled pull request costs one `refs/pull/<n>/head` fetch, cached by number. A closed pull request's issue events are read only when it holds back a local commit.
- The content-prefix fallback is removed, so identical bytes a person committed never count as a publication.

## Verification

Each of these tests fails with its fix reverted.

`knowledge-publication-history.test.ts` covers:

- the derivation from carried patches, uncapped, and a forged record;
- a forged record that cannot drop a local commit;
- a pull request merged before records existed;
- a host with empty state;
- more than 64 publications;
- `MERGED` before its merge commit;
- a person's force-push;
- a branch a person deleted, GitHub's close after it, and a person's close just before a deletion;
- author dates a day ahead and a year behind, and an identical change regenerated at once after a revert of a squash, a rebase and a merge, where the test forge's rebase writes new commits as GitHub's does;
- a person's close whose head GitHub no longer serves;
- a merged pull request whose head GitHub does not serve;
- the incremental history read, kept across a host key change and dropped for another repository;
- a large backlog read in batches;
- base changes against the merge commit, with a formatting commit, another path's edit and acknowledgement;
- the cache for another host, another head, or none;
- the wait schedule for no checks and a draft, across kinds;
- a busy base that moves during a wait, without a new push;
- transient failures with alternating codes;
- the merge queue.

`knowledge-publication-ancestry.test.ts` shows git asked once per merge commit, parent and pair.

`knowledge-publication-github-repository.test.ts` covers remote URL forms, a GHES remote, SSH host aliases including `ssh.github.com` on port 443 and an IP address, `ssh.github.com` remotes when `ssh -G` fails, an alias gh did not know resolved again after five minutes, a fork clone with `publication.remote`, `--repo`, `--hostname` and filled-in endpoints, a fork's pull request, and gh's real three pages read page by page.
