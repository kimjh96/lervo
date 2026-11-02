# ADR-0478: Renew each delegation with one writer

Status: `accepted`
Decision date: 2026-10-06
Amends: [ADR-0469](0469-keep-background-knowledge-continuous-on-every-host.md) (renewal), [ADR-0471](0471-keep-cross-host-knowledge-ownership-safe-when-hub-coordination-fails.md) (identity-preserving rebind), [ADR-0456](0456-hand-off-repositories-atomically-with-a-writer-lease.md) (host-local replica paths)
Amended by: [ADR-0483](0483-run-replica-commands-through-one-current-runtime.md) (peer runtime must share capture semantics), [ADR-0561](../../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md) (renewal within the policy limits)

> **Amended (2026-11-02).** Under [ADR-0561](../../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), the owner renews a delegation outside the policy limits narrowed to them: the allowed providers it already had and the lower of each ceiling, with the same deterministic expiry. A follower adopts the owner's term when the owner's scope equals its own scope narrowed the same way.
Related: [ADR-0466](0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md), [ADR-0468](0468-propagate-knowledge-supersession-across-replicated-checkouts.md), [ADR-0473](../../knowledge/documents/0473-publish-knowledge-within-its-write-scope-and-never-rewrite-a-tool-generated-document.md)

## Context

Under ADR-0469, every host renews `.lervo/knowledge/convergence-delegation.json` using its own continuity policy. In repository plen, `HEAD` tracks this file because its addition predates the `.lervo/.gitignore` rule. The repository replica mirrors the Mac and WSL checkouts under ADR-0468. Three defects combined on 2026-10-06:

1. Hosts renewed on independent clocks: WSL at 09:02:17Z and Mac at 09:14:28Z. With expiry set to `now + termDays` and `reviewedAt` set to wall-clock time, they produced different uncommitted versions of one tracked file. During this period, the Mac replica log showed `repository_replica_apply_failed`, `repository_replica_supersession_failed`, and transfer timeouts.
2. Replica apply reverted renewals. `applyTrees` runs `git reset --hard` and `checkout-index --force`; capture excluded the delegation from every snapshot by restoring its `HEAD` entry. Applying or merging therefore restored the committed delegation, expiring at 2026-10-07T19:00Z. WSL's `lervo upgrade --apply` at 11:30Z changed generated files, causing the next replica cycle to apply a merged snapshot. The resident then recorded `rebound / binding_refresh` from the committed version. A test reproduces this revert; `lervo upgrade` itself never writes the file.
3. ADR-0456's host-local exclusion assumed an untracked grant. For a tracked grant, it hid divergence without preserving either host's bytes.

Renewals were silently lost, leaving the delegation to lapse unless a later renewal survived.

## Decision

### Exactly one host writes a renewal

The **delegation writer** is the host allowed by the ADR-0466 commit grant: the Hub lease holder in Hub mode, the standalone owner in standalone mode, or a host with no owner-host configuration. Only this writer renews a due delegation or rebinds drifted suite and role hashes. Continuity reads the grant from the ownership fence at the start of each reconciliation.

Every other host is a **follower** and never independently renews or rebinds. It follows the owner according to whether `HEAD` tracks the delegation:

- `follower`: The delegation is untracked and host-local. The follower adopts the owner's term from the owner's Hub host record only when the record is at most 2 hours old, its owner role is `owner`, its scope hash matches the local scope hash, its delegation is active, and its expiry exceeds both the local expiry and now. The local policy must be active, permit the scope, and have a horizon covering the new expiry. The follower then writes a same-scope renewal of its own delegation to the owner's expiry.
- `replica_follower`: The delegation is tracked shared repository content. The replica carries the owner's exact worktree bytes; the follower writes nothing.

Seeding a missing delegation remains unchanged and runs on any host: there are no previous bytes from which writers could diverge.

A follower whose renewal is due records `awaitingOwner` and reconciles after 15 minutes instead of an hour. A host that has just claimed ownership therefore renews within one retry interval.

### Renewal is a pure function of the previous delegation and the policy

Renewal no longer uses the host clock to choose its bytes:

- `expiresAt` is the first whole term after the previous expiry whose renewal window has not opened: `previous + k × termDays`, using the smallest `k ≥ 1` satisfying `expiresAt − windowHours > now`, capped at the policy horizon. Renewal inside the window always yields `previous + termDays`; a lapsed delegation resumes on the same lattice.
- `review.reviewedAt` retains the last owner review time. Renewal and rebind continue an existing review rather than starting one. The `knowledge.convergence.delegation.continued` event records the continuation time.
- `review.planHash` is recomputed as before and covers the plan, including the new expiry.

Equal previous delegations and policies produce equal bytes on every host at any instant within one renewal window. A successor owner therefore writes the same renewal as the previous owner. The production pair would have produced identical renewals at 09:02 and 09:14.

### A lapsed but renewable delegation stays eligible for ownership

Previously, only an unexpired delegation allowed a host to contend for the Hub lease. Combined with one writer, this would leave a fleet of lapsed grants without an owner able to renew.

A host is now also eligible when its delegation is `active` in state but expired and its host continuity policy would renew it (`decideDelegationRenewal` returns `renew`). It claims the lease through the ordinary protocol, then renews as owner. Revoked delegations, delegations outside policy limits, and delegations without a policy remain ineligible.

### A tracked delegation replicates; an untracked one stays host-local

After staging, replica capture still restores the `HEAD` entries of `.lervo/state` and `.lervo/data`. It restores the delegation's `HEAD` entry only when `HEAD` does not track it.

A tracked delegation enters snapshots with its worktree bytes. Apply, merge, and rollback reproduce those bytes instead of resetting them to `HEAD`. An untracked delegation retains ADR-0456 behavior: it never enters snapshots, and apply cleanup preserves it.

Different delegation bytes in the two checkouts merge like other divergence under `.lervo/knowledge/`. A conflict confined to Lervo-managed knowledge paths resolves to the merging side and is reported without failing the replica. Only the owner writes afterward, keeping the checkouts identical. The snapshot-cache fingerprint version changes to `v2` because capture now includes changed bytes for a tracked delegation.

### Renewals are not published

Renewals remain working-tree changes and are not committed through ADR-0466 or ADR-0473 knowledge publication:

1. The replica already gives both checkouts identical bytes without touching branches; Hub records give the same term to hosts without a replica.
2. Publication requires a pull request merged into the integration branch. Waiting for that merge could let the delegation lapse.
3. Monthly authority-grant commits would add noise to owner history and branches. For hosts with an untracked file, committing it would also make the next merge abort on that file, as ADR-0477 observed for suites.
4. Grants name host-local accountable agents. New repositories keep the file ignored and untracked through `.lervo/.gitignore`; this remains the recommended layout.

An owner may stop tracking the file in plen through ordinary review using `git rm --cached .lervo/knowledge/convergence-delegation.json`. It then becomes host-local, and followers use the Hub record.

## Events, state, and failure meaning

`knowledge.convergence.delegation.continued` (event schema 4) gains an action and source: a follower adopting the owner's term records `action: "adopted"`, `source: "owner"`, and `sourceHostHash` identifying the owner host. Other required fields, privacy handling (hashes and expiry only), and the event ID derived from `planHash` remain unchanged. As with every schema-4 event, readers must deploy before writers that emit it.

`.lervo/state/knowledge/convergence-continuity.json` may record `lastContinuation.action: "adopted"` with `source: "owner"`. The in-memory continuity result adds `awaitingOwner`, true when renewal is due on a host that may not write it. This result is not persisted and only selects the retry interval.

No failure code is added. A waiting follower writes nothing and reports no failure. Existing `delegation_expiring` and `delegation_expired` findings retain their meaning and remain below `owner_decision` while the host policy can renew the delegation.

## Compatibility and deploy order

Capture semantics change only for tracked delegations. During mixed-version rollout, hosts compute different snapshots for a checkout with a renewed tracked delegation. Its replica cycles report divergence or fail post-apply verification until both hosts run this version. No other repository is affected.

1. Deploy CLI and Node bundles on every host. No Hub change is needed; host records and the lease are unchanged.
2. Restart Nodes and the host resident service on both hosts in the same maintenance window.
3. The next replica cycle merges existing tracked-delegation differences. The next owner reconciliation renews if due, and the replica carries the renewal to the follower.

## Consequences

- One host writes each renewal; followers receive identical bytes through the replica or the identical term through Hub records.
- Replica apply, merge, rollback, and upgrades that trigger them never discard a newer delegation.
- A successor after the owner stops renews to the expiry the owner would have chosen, even after every grant has lapsed.
- `reviewedAt` means the last owner review, not the last automated continuation.

## Deferred

- Standalone hosts have no Hub record. A follower without a replica cannot adopt a term; it keeps its grant until it owns, then renews on the same lattice.
- A follower whose untracked delegation names different accountable agents adopts only the owner's term. Its bytes retain its own agent identities, which never cross hosts.

## Verification

Focused tests show:

- Decisions at several instants within one renewal window produce identical delegation bytes; a lapsed delegation resumes on the term lattice.
- Two simulated hosts share a Hub lease and host records. Only the owner renews. A follower with renewal due writes nothing, retries in 15 minutes, then adopts the owner's term with identical bytes and an `adopted / owner` event.
- A follower with a tracked delegation writes nothing. After the owner stops and every grant lapses, the follower claims the lease, renews, and writes exactly the previous owner's bytes.
- Replica apply carries a tracked delegation's owner renewal byte for byte and preserves it through an unrelated apply. A coordinator cycle pulls the renewal, then merges later changes on both sides without restoring `HEAD`'s grant. An untracked grant stays host-local.
- `lervo upgrade --apply` with the `knowledge_materialization` stage leaves a renewed tracked delegation unchanged.
