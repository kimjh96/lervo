# ADR-0603: Derive knowledge publication from repository policy and judge it by content

Status: `accepted`
Decision date: 2026-11-21
Amends: [ADR-0466](../../coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md) (how the owner merges and recognizes publication), [ADR-0594](0594-keep-knowledge-publication-moving-and-apply-owner-rules-on-every-host.md) (publication progress), [ADR-0596](0596-recover-knowledge-publication-from-failed-checks.md) (failure detail and retry)
Applies: [ADR-0602](0602-wait-on-change-tokens-and-guard-idle-timers.md) (no timer on external state that sends no push)
Related: [ADR-0473](../documents/0473-publish-knowledge-within-its-write-scope-and-never-rewrite-a-tool-generated-document.md), [ADR-0482](../semantics/0482-absorb-squash-merged-semantic-candidates-and-type-verification-source-changes.md) (the same squash recognition for semantic candidates)

## Context

flemo's base branch allows only squash merges. Its ruleset `main` sets `allowed_merge_methods: ["squash"]`, and its required checks must pass on an up-to-date head. Lervo always ran `gh pr merge --merge`. So pull request #557 passed every check and still failed four times with `knowledge_publication_merge_failed`, detail `gh merge exit 1 unknown`. The next retry waited for the next reconcile, 16 hours later.

The same assumption broke more than the merge. Lervo recognized published commits by ancestry and patch identity (`git cherry`). A squash or rebase merge leaves neither:

- The inventory still listed published commits as unpublished.
- Replaying the oldest of them onto the squashed base conflicted.
- Lervo then superseded commits it had just published, closed the pull request, and reset the branch.

On 2026-11-02 at 13:47 flemo superseded eight knowledge commits against base `d908f0783` (squash #538). All 67 paths they touched held exactly the bytes that squash had merged. That is the rollback the owner saw.

The class is wider than squash. Any policy requirement Lervo did not read could fail at merge, and any merge method other than a merge commit could make Lervo think its outputs were dropped.

## Decision

### Publication follows the repository's own policy

Before anything is pushed, each publication reads the policy for the base branch and for the publication branch:

- the repository's merge settings (`allow_merge_commit`, `allow_squash_merge`, `allow_rebase_merge`);
- every active rule on each branch (`GET /repos/{owner}/{repo}/rules/branches/{branch}`);
- classic branch protection for both branches.

Each source can only narrow what is allowed:

- A setting the forge does not report is unknown, never allowed.
- The rules endpoint answers an empty list for a branch without rules, so rules it refuses to show (404, 403) are unknown, and unknown rules refuse.
- A branch's own `protected` flag needs no admin rights. When it is false, the branch has no classic protection. When it is true, protection details the host may not read are unknown and refuse.
- A private repository whose plan has no rulesets or protection answers 403 `Upgrade to GitHub Pro or make this repository public`. Nothing of that kind can apply there, so it reads as none. Lervo's own repository answers this way.
- Rules are read with `gh api --paginate --jq '.[]'`, which also works on gh releases before 2.48.

| Requirement                                                                                                                                                                               | Effect                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pull_request.allowed_merge_methods`                                                                                                                                                      | Only those methods                                                                                  |
| `required_linear_history`                                                                                                                                                                 | No merge commit                                                                                     |
| `required_signatures` on the base                                                                                                                                                         | Only a squash, which the forge signs                                                                |
| `required_status_checks`                                                                                                                                                                  | Those checks must report and pass; one that never reports fails, by name, once the others finished  |
| strict status checks                                                                                                                                                                      | A head behind the base waits and is rebuilt on the new base                                         |
| required reviews                                                                                                                                                                          | The pull request opens and waits for a person                                                       |
| `merge_queue`, or a merge queue set in classic protection                                                                                                                                 | Entered through the queue, which merges with its own method                                         |
| `update` on the base                                                                                                                                                                      | Refused: a merge updates the base, and only bypass actors may                                       |
| Any other rule on the base, such as required deployments, code scanning, required workflows or commit patterns                                                                            | Refused by name                                                                                     |
| Any rule on the publication branch but `deletion`, `pull_request`, `required_status_checks` and `required_linear_history`, or protection that forbids force pushes or requires signatures | Refused: Lervo rebuilds that branch on each base, creates it when it is gone, with unsigned commits |

Lervo prefers a merge commit, then a squash, then a rebase. A requirement Lervo cannot meet is refused before the push: `knowledge_publication_policy_refused`, with a detail that names the branch and the rule. Nothing is pushed. A required review is not refused: the pull request opens and waits for a person.

Before merging, the forge's own merge state decides:

- **behind**, **conflict**, **blocked** for a reason the forge does not name, **draft**, or **queued:** wait; the next cycle rebuilds or reads again.
- **review required:** wait for a person.
- **queue:** enter the merge queue for the exact head.
- **ready:** merge with the planned method, for the exact head.

The gate comes from GraphQL (`mergeStateStatus`, `reviewDecision`, `isDraft`, `isInMergeQueue`, `isMergeQueueEnabled`), because `gh pr view` reports no merge queue. A merge counts once the forge reports the pull request `MERGED`. A merge command that succeeds without merging and without a queue is a failure.

### GitHub-side waits back off, then arm no timer

Checks, merge gates and reviews live on GitHub, which sends Lervo no push. Following ADR-0602, Lervo does not poll them forever:

- **Checks and gates:** no check reported, only skipped checks, a check stuck queued, a draft, a conflict, a blocked merge or the merge queue. Each is read again after 2 minutes, doubling to 1 hour.
- **Reviews:** read again after 15 minutes, then 1 hour.
- After that no timer is armed. The wait becomes `knowledge_publication_waiting` or `knowledge_publication_awaiting_review` attention, and the pull request is read on the next cycle that runs for another reason: a local change, a Hub push or a deadline.
- The state's `wait` is keyed on the pull request and a digest of the commits it carries. Its looks count across kinds, so alternating between checks and a gate still runs out. Only a new pull request or a new set of commits starts it over.
- A base move alone pushes nothing. While the open pull request's head carries the same change as the rebuilt tip, compared by zero-context patch id against its own fork point, the head stays. So a busy base neither restarts checks nor dismisses reviews, and the wait still runs out. Only a gate of `behind` or `conflict` rebuilds and pushes the head.
- Transient failures follow the same schedule, then the next cycle. They count together whatever their codes (`transientFailures`), so alternating codes cannot restart the backoff.
- A failed check arms no timer either (ADR-0596): a later cycle reads it again no sooner than its backoff.

### What is published, and the owner's decisions

[ADR-0607](0607-read-what-is-published-from-github-pull-request-heads.md) decides how Lervo knows what is published, which repository every gh call targets, and how it keeps the owner's decisions on GitHub.

### Failures say why and retry on their own deadline

- **Detail:** a forge failure carries GitHub's own reason after its class, for example `gh merge exit 1 method_not_allowed: GraphQL: Merge commits are not allowed on this repository. (mergePullRequest)`. The reason is one line, at most 200 characters, with tokens and URL credentials redacted. It stays in this host's private publication state.
- **Transient failures:** network failures, rate limits (GitHub answers 403 or 429), pending checks, not mergeable, a merge command that does not merge, an unclassified forge refusal, and Git fetch or push failures. These retry after 2 minutes, doubling to 1 hour, then on the next cycle that runs for another reason.
- **Permanent failures:** a policy refusal, a refused merge method, authentication, a push a ruleset or protection refused (GH013, GH006, detail `rule_refusal`), a scope violation, and a publication remote that names no GitHub repository. These stay attention and wait for a change.

## Consequences

- flemo publishes again with a squash, and its later cycles neither re-publish nor supersede what the squash carried.
- The 16 entries already in flemo's supersession ledger name published commits. Dropping them from local branches loses nothing, because their content is in the base.
- One publication reads the closed pull request history, paginated, and up to seven policy endpoints. It reads them only when there is something to publish, a pull request is open, or a merge commit is not yet known. It fetches `refs/pull/<n>/head` once for each settled pull request, and the issue events only of a closed pull request that holds back a local commit.
- Lervo enters merge queues but does not sign commits. A repository that needs signed commits on the publication branch refuses visibly until its policy changes.
- An earlier version of this change read the free-plan 403 as unreadable rules, which would have refused every publication on Lervo's own repository. The answer is now read as none.

## Verification

Each of these tests fails with its fix reverted.

`knowledge-publication-policy.test.ts` covers:

- policy reduction, including `merge_queue`, `update` and unreadable protection;
- a squash-only repository;
- a person's squash merge, the flemo rollback, and a later edit;
- a revert that is reported and never republished;
- a merge command that does not merge;
- unknown and unreadable rules, the free-plan 403 and the rate-limit 403;
- the review schedule;
- the merge gate, drafts and merge queues;
- refusal before push;
- the retry deadlines.

`knowledge-publication.test.ts` covers a refused body update, the adapter's merge methods, the redacted reason and the refused-method class. ADR-0607 lists the tests of what is published.
