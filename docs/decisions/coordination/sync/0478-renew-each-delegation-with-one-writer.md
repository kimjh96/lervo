# ADR-0478: Renew each delegation with one writer

Status: `accepted`
Decision date: 2026-10-06
Amends: [ADR-0469](0469-keep-background-knowledge-continuous-on-every-host.md) (renewal), [ADR-0471](0471-keep-cross-host-knowledge-ownership-safe-when-hub-coordination-fails.md) (identity-preserving rebind), [ADR-0456](0456-hand-off-repositories-atomically-with-a-writer-lease.md) (host-local replica paths)
Amended by: [ADR-0483](0483-run-replica-commands-through-one-current-runtime.md) (peer runtime must share capture semantics)
Related: [ADR-0466](0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md), [ADR-0468](0468-propagate-knowledge-supersession-across-replicated-checkouts.md), [ADR-0473](../../knowledge/documents/0473-publish-knowledge-within-its-write-scope-and-never-rewrite-a-tool-generated-document.md)

## Context

Every host renews the convergence delegation in `.lervo/knowledge/convergence-delegation.json` under its own continuity policy (ADR-0469). In repository plen, `HEAD` tracks that file because the commit that added it predates the `.lervo/.gitignore` rule. The repository replica mirrors the Mac and WSL checkouts (ADR-0468). On 2026-10-06 three defects combined:

1. Each host renewed on its own clock. The WSL resident renewed at 09:02:17Z and the Mac resident at 09:14:28Z. The new expiry was `now + termDays`, and `reviewedAt` was the wall-clock time, so the two working trees held different uncommitted versions of one tracked file. The Mac replica log showed `repository_replica_apply_failed`, `repository_replica_supersession_failed`, and transfer timeouts during the same period.
2. Replica apply reverted the renewals. `applyTrees` runs `git reset --hard` and `checkout-index --force`. Capture had excluded the delegation from every snapshot by restoring its `HEAD` entry, so no snapshot carried the renewed bytes. A tracked delegation therefore fell back to the committed version (expiry 2026-10-07T19:00Z) on the checkout that received an apply or a merge. The WSL `lervo upgrade --apply` at 11:30Z changed generated files, so the next replica cycle applied a merged snapshot. The resident then recorded `rebound / binding_refresh` from the committed version. A test reproduces the revert; `lervo upgrade` itself never writes the file.
3. The host-local exclusion that ADR-0456 introduced assumed that the grant is untracked. For a tracked grant, the exclusion only hid divergence. It did not keep each host's bytes.

The renewals were lost without any error, and the delegation would lapse unless a later renewal survived.

## Decision

### Exactly one host writes a renewal

The **delegation writer** is the host the ADR-0466 commit grant allows. That is the Hub lease holder in Hub mode, the standalone owner in standalone mode, or a host with no owner-host configuration at all. Only the writer renews a due delegation or rebinds drifted suite and role hashes. Continuity reads the grant from the ownership fence at the start of each reconciliation.

Any other host is a **follower**. A follower never writes a renewal or a rebind of its own. It follows the owner in one of two ways:

- `follower`: `HEAD` does not track the delegation, so the file is host-local. The follower adopts the owner's term from the owner's Hub host record. It accepts the record only if it is at most 2 hours old, its owner role is `owner`, its scope hash equals the local scope hash, its delegation is active, and its expiry is later than both the local expiry and now. The local policy must be active, permit the scope, and have a horizon that covers the new expiry. The follower then writes the same-scope renewal of its own delegation to the owner's expiry.
- `replica_follower`: `HEAD` tracks the delegation, so the file is shared repository content. The repository replica carries the owner's exact worktree bytes to the follower. The follower writes nothing.

Seeding a missing delegation is unchanged and runs on any host. A missing file has no previous bytes for two writers to diverge from.

A follower whose renewal is due records `awaitingOwner` and reconciles again after 15 minutes instead of an hour. A host that has just claimed ownership therefore renews within one retry interval.

### Renewal is a pure function of the previous delegation and the policy

A renewal no longer reads the host clock to choose its bytes:

- `expiresAt` is the first whole term after the previous expiry whose own renewal window has not opened yet. The formula is `previous + k × termDays`, with the smallest `k ≥ 1` that satisfies `expiresAt − windowHours > now`. The result is capped at the policy horizon. A renewal inside the window always yields `previous + termDays`. A lapsed delegation resumes on the same lattice.
- `review.reviewedAt` keeps the time of the last owner review. A renewal or a rebind continues an existing review. It does not start a new review. The `knowledge.convergence.delegation.continued` event records when the continuation happened.
- `review.planHash` is recomputed as before. It covers the plan, including the new expiry.

Equal previous delegations and policies produce equal bytes on every host, at any instant inside one renewal window. A host that takes over ownership therefore writes the same renewal the previous owner wrote. The production pair would have produced identical renewals at 09:02 and 09:14.

### A lapsed but renewable delegation stays eligible for ownership

Before this decision, a host contended for the Hub lease only with an unexpired delegation. Under the single-writer rule, a fleet where every grant had lapsed would have had no owner, and no host could have renewed. A host is now also eligible when its delegation is `active` in state but expired, and its host continuity policy would renew it (`decideDelegationRenewal` returns `renew`). That host claims the lease through the ordinary lease protocol and then renews as the owner. Revoked delegations, delegations outside policy limits, and delegations without a policy stay ineligible.

### A tracked delegation replicates; an untracked one stays host-local

Replica capture still restores the `HEAD` entries of `.lervo/state` and `.lervo/data` after staging. It restores the delegation's `HEAD` entry only when `HEAD` does not track the delegation. A tracked delegation therefore enters the snapshot with its worktree bytes. Replica apply, merge, and rollback reproduce those bytes and no longer reset them to `HEAD`. An untracked delegation keeps the ADR-0456 behavior. It never enters a snapshot, and apply cleanup preserves it.

When both checkouts hold different delegation bytes, the replica merges them as any other divergence under `.lervo/knowledge/`. A conflict confined to Lervo-managed knowledge paths resolves to the merging side and is reported, so the replica does not fail on it. After that merge, only the owner writes again, so the two checkouts stay identical. The snapshot-cache fingerprint version changes to `v2` because the captured bytes for a tracked delegation changed.

### Renewals are not published

A renewal stays a working-tree change and is not committed through ADR-0466 or ADR-0473 knowledge publication. Four reasons decide this:

1. The replica already gives both checkouts identical bytes without touching any branch, and the Hub record gives the same term to hosts without a replica.
2. Publication lands through a pull request on the integration branch. A renewal that had to wait for a merge could lapse first, which is the failure this decision removes.
3. A monthly commit of an authority grant would add noise to the owner's history and branches. On hosts where the file is untracked, the commit would also make the next merge abort on an untracked file, as ADR-0477 observed for suites.
4. The grant names host-local accountable agents. New repositories keep the file ignored and untracked (`.lervo/.gitignore`), and that remains the recommended layout.

An owner who wants plen to stop tracking the file can remove it from the index (`git rm --cached .lervo/knowledge/convergence-delegation.json`) through ordinary review. The file then becomes host-local, and followers use the Hub record.

## Events, state, and failure meaning

`knowledge.convergence.delegation.continued` (event schema 4) gains one action and one source. A follower that adopted the owner's term records `action: "adopted"` with `source: "owner"`, and `sourceHostHash` names the owner host. The other required fields, the privacy handling (hashes and the expiry only), and the event ID (derived from `planHash`) are unchanged. Readers must deploy before writers that emit it, as for every schema-4 event.

`.lervo/state/knowledge/convergence-continuity.json` may record `lastContinuation.action: "adopted"` with `source: "owner"`. The in-memory continuity result adds `awaitingOwner` (true when a renewal is due on a host that may not write it). The result is not persisted and selects only the retry interval.

No failure code is added. A follower that waits writes nothing and reports no failure. The existing `delegation_expiring` and `delegation_expired` findings keep their meaning. While the host policy can renew the delegation, they stay below `owner_decision`.

## Compatibility and deploy order

Capture semantics change for a tracked delegation only. During a rollout where only one host captures the new way, the two hosts compute different snapshots for a checkout with a renewed tracked delegation. Replica cycles for that checkout then report divergence or fail post-apply verification until both hosts run this version. No other repository is affected.

1. Deploy the CLI and Node bundles on every host. No Hub change is needed: host records and the lease are unchanged.
2. Restart the Nodes and the host resident service on both hosts in the same maintenance window.
3. The next replica cycle merges any existing difference in the tracked delegation. The next owner reconciliation renews the delegation if it is due, and the replica carries that renewal to the follower.

## Consequences

- One host writes each renewal. The other host receives the identical bytes through the replica, or the identical term through the Hub record.
- Replica apply, merge, rollback, and upgrades that trigger them never discard a newer delegation.
- A host that takes over after the owner stops renews to the same expiry the owner would have chosen, even after every grant has lapsed.
- `reviewedAt` now means the last owner review, not the last automated continuation.

## Deferred

- Hosts in standalone mode have no Hub record, so a follower without a replica cannot adopt a term. It keeps its own grant until it owns, and then renews on the same lattice.
- A follower whose untracked delegation names different accountable agents than the owner's adopts the term only. Its bytes differ from the owner's in those agent identities, which never cross hosts.

## Verification

Focused tests show:

- Renewal decisions at several instants inside one window produce the same delegation bytes, and a lapsed delegation resumes on the term lattice.
- Two simulated hosts share a Hub lease and host records. Only the owner renews. A follower whose renewal is due writes nothing and retries in 15 minutes, then adopts the owner's term with identical bytes and an `adopted / owner` event.
- With a tracked delegation, the follower writes nothing. After the owner stops and every grant lapses, the follower claims the lease, renews, and writes exactly the bytes the previous owner wrote.
- Replica apply carries an owner's renewal of a tracked delegation byte for byte and keeps it through an unrelated apply. A coordinator cycle pulls the renewal, then merges later changes on both sides without restoring `HEAD`'s grant. An untracked grant still stays host-local.
- `lervo upgrade --apply` with the `knowledge_materialization` stage leaves a renewed tracked delegation unchanged.
