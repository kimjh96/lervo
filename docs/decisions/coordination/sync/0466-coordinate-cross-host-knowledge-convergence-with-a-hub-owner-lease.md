# ADR-0466: Coordinate cross-host knowledge convergence with a Hub owner lease

Status: `accepted`
Decision date: 2026-10-05
Amends: [ADR-0457](../../knowledge/documents/0457-degrade-knowledge-intake-per-file-and-consolidate-documents.md) (one convergence owner across hosts), [ADR-0434](../../knowledge/repository/canonicalization/0434-converge-background-canonicalization-normalization-and-knowledge.md)
Related: [ADR-0456](0456-hand-off-repositories-atomically-with-a-writer-lease.md), [ADR-0461](../../operations/services/0461-drive-resident-runtime-service-work-from-changes-not-timers.md)

## Context

The Lervo repository runs a delegated knowledge resident on two hosts at once: the Mac (`com.lervo.mac.knowledge`) and WSL (the resident child of the Lervo Node). Each host keeps its own clone, event store, delegation grant, and worker lock. Both normalize, canonicalize, and commit `Lervo Knowledge` outputs independently. ADR-0434 requires one convergence owner per repository, and ADR-0457 proposes binding that owner to the ADR-0456 writer lease or to a `hostIdentityHash` in the delegation grant. Neither exists in code: the worker lock is a PID file, the grant has no host identity, and the writer lease is not implemented.

The owner rejects a fixed "Mac only" rule. Work starts from Claude Code or Codex on the Mac and from Discord through the WSL Hub and Nodes, so either host must be able to converge. Local execution without a Hub must keep working (invariant 1).

The Lervo repository was also removed from Mac and WSL replica coordination after repeated divergence. The Mac replica log records 6,940 `divergent` cycles across 1,047 distinct snapshot pairs and 81 `changed while current parity was being verified` failures. Only three cycles reported conflicting paths. Most divergence came from both sides moving between cycles: two residents produced knowledge outputs, developers committed on the Mac, and Node turns wrote on WSL. Every cycle therefore found both sides past the common snapshot.

## Decision

### One owner lease per repository identity, hosted by the Hub

The Hub stores one convergence owner lease per destination, project, and repository identity hash (`projectId` plus `createdAt`, identical on every clone). Hosts claim or release it through `/v1/sync/projects/{projectId}/knowledge-convergence-owner` with the existing `workspace.coordinate` permission; reads need `workspace.read`. The Hub applies one pure decision inside a write transaction:

- A claim by the live holder renews the lease.
- A claim against a vacant, released, or expired lease grants the next generation and reports how the predecessor ended (`expired` or `released`).
- Any other claim returns `held_elsewhere` with the live holder.
- Only the holder of the exact generation can release.

The Hub clock decides expiry. A host converts the remaining Hub lifetime into local time from the instant its request started and subtracts a 60-second margin, so clock skew between hosts cannot give both a live lease.

A lease is not a writer lease. ADR-0456's writer lease never expires silently because it guards human work. Background convergence must continue when a host dies, so the owner lease expires after 30 minutes without renewal.

### Host identity and coordination mode

Each checkout keeps host-local configuration in `.lervo/state/knowledge/convergence-owner-host.json`. Git ignores this file and replica capture excludes it. It holds a random `hostId`, an operator label such as `mac` or `wsl`, and a coordination mode:

- `hub`: Hub coordinates (`baseUrl`, `bearerTokenFile`, `destinationId`, `hubIdentityHash`). The Hub lease decides ownership.
- `standalone`: the default for an unconfigured host. The host owns convergence locally, as before.

Only `hostHash = sha256("lervo.convergence-owner-host.v1\0" + hostId)` leaves the host. This replaces ADR-0457's `hostIdentityHash` in the delegation grant: the grant stays host-local and unchanged.

### Roles

Each resident cycle and each CLI worker run first resolves one verdict:

- `owner`: may converge and commit until its local validity ends.
- `waiting_owner`: another host holds a live lease. Health state `waiting`, reason `waiting_owner:<holder label>`.
- `unverifiable`: ownership cannot be proven. Causes are a Hub outage without a live local lease, an invalid host configuration, or a missing transport. Health state `attention`. When a Hub request failed, the verdict also names its cause in `failureCode` and `httpStatus`, defined below.
- `contended`: a standalone host found another host's knowledge commit from the last 30 minutes. Health state `attention`.
- `ineligible`: a Hub-mode host without an active, unexpired delegation for its provider. It does not contend and releases a lease it held.
- `yielding`: an operator released this host's lease. The host does not reclaim for 30 minutes.

Every non-owner runs only read-only debt detection: the currency, normalization, and candidate inspection behind `lervo knowledge convergence status`. It records no baseline, calls no provider, writes no document, and claims no delivery. Its queued change jobs wait. They run only if the host later becomes owner. Meanwhile the owner's baseline discovery covers the same bytes once they replicate.

### No commit without ownership

Every observation writes the verdict to the private fence `.lervo/state/knowledge/convergence-owner.json` before returning. `commitSettledKnowledgeOutputs` and the freshness commit consult it. A configured host commits only while its fence says `owner` within validity. A host with neither configuration nor fence keeps the legacy single-host behavior. Every owner commit carries the trailer `Lervo-Convergence-Host: <hostHash>`.

A heartbeat renews the lease every 10 minutes, a third of the lifetime. If a renewal shows that ownership was lost, the resident aborts the running full cycle through the same signal that shutdown uses.

### No Hub

Invariant 1 holds in two ways:

- A `standalone` host needs no Hub. To avoid silent double ownership, it reads its bounded first-parent history for `Lervo Knowledge` commits with a different host trailer, newer than one lease lifetime. If it finds one, it records `contended` and stops committing until that commit ages out. Two unconfigured hosts on one repository therefore surface attention after the first commit crosses between them.
- A `hub` host that loses the Hub keeps ownership only until its proven lease ends locally. Without proof it records `unverifiable` and degrades explicitly. It never falls back to standalone.

### Deterministic handoff

A deploy restart does not release the lease. The restarted process on the same host renews it, keeping the same generation. A host that dies hands over 30 minutes after its last renewal. A waiting host schedules its next cycle 5 seconds after the holder's Hub expiry through the ADR-0461 `earliestAvailableAt` input, so it never polls. The ownership role and holder enter the ADR-0461 change fence, so gaining or losing ownership always runs one full cycle. A planned handoff uses `lervo knowledge convergence owner release`. The peer claims at its next cycle, within the 15-minute reconciliation ceiling.

### One history through replicas

The owner's commits reach the other checkout through the replica coordinator. Fast-forwards pull or push them, and non-overlapping concurrent work merges under ADR-0404. Owner identity, fence, and delegation live under excluded paths and never cross. The Lervo repository can rejoin replica coordination once both hosts run Hub-mode ownership. The [cross-host ownership specification](../../../specs/background-knowledge-convergence/runtime/ownership-and-activation/cross-host-ownership.md) gives the procedure.

### Publication to the shared remote

Replication moves owner commits between the two checkouts, but nothing moved them to GitHub. Before this decision, batch-boundary commits from ADR-0465 piled up on the Mac's local `main`, and a person opened pull requests by hand to publish them. Local `main` then diverged from `origin/main` whenever anything else merged.

After every resident cycle, the owner publishes its settled commits. Only the host whose fence grants `owner` publishes, and only when its host configuration has a `publication` block:

1. Fetch the base branch and the publication branch from the configured remote with the host's own Git credentials.
2. Select the unpublished knowledge commits in `remote/base..HEAD`: non-merge commits whose author and committer are both `Lervo Knowledge`, and whose patch is not already upstream according to `git cherry`. Every other commit counts as other work and is never published.
3. Refuse the whole publication if any selected commit changes a path outside the allowed roots (default `docs/` and `.lervo/knowledge/`).
4. Choose the publication tip, always on top of the current remote base. If `HEAD` already descends from the remote base and `base..HEAD` holds only the selected commits, the tip is `HEAD`. Otherwise the selected commits are replayed onto the remote base in a temporary worktree. This includes a local branch that holds only knowledge commits but still sits on an older base.
5. A replay conflict means the outputs were computed against stale source bytes, so those commits are never published. The publisher closes the open publication pull request and keeps the local head under a backup ref. If the local base branch is checked out and holds no developer work, `reset --keep` moves it to the remote base, and the next cycle regenerates the outputs there. Otherwise the superseded commits are recorded and never selected again. The publisher records status `superseded`, with the conflicting path count.
6. Push the tip to one rolling branch (default `lervo/knowledge-outputs`) with `--force-with-lease` on the observed branch head. The base branch is never pushed.
7. Open or update one pull request through the host's authenticated `gh` CLI. A pull request closed outside the publisher is never reused; the next publication opens a new one. Its title is `docs: publish reviewed background knowledge`, and its body follows `.github/PULL_REQUEST_TEMPLATE.md` section by section, starting at H2. The body checks only the items the publisher verified itself and states why each other item stays unchecked.
8. With `merge: when_checks_pass`, merge with a merge commit through `--match-head-commit` once every reported check on that exact head succeeded. With `merge: never`, stop at the open pull request. GitHub auto-merge is disabled for this repository and no rule forbids an automated merge, so the publisher checks CI itself.
9. After a merge, bring local `main` up to the remote base only when no work can be lost. If `HEAD` is an ancestor of the base, fast-forward. If every local-only commit is a non-merge patch already upstream, use `reset --keep`, which also preserves uncommitted edits. In any other case, leave local `main` alone and record `local_diverged`.

Authority for these writes is the host's reviewed delegation plus the live owner lease. The delegation authorizes convergence commits; the publication block is the host operator's opt-in for pushing and merging them. Developer work never enters the branch, so invariant 5 holds.

## Events, states, and failure meaning

`knowledge.convergence.owner.changed` (event schema 4) is appended to the observing host's own event store whenever the holder it observes changes, and when it ends its own holding.

- Required fields: `repositoryIdentityHash`, `holderHostHash` or null, `previousHolderHostHash` or null, `observerHostHash`, `generation` or null (null in standalone mode and on release), `mode` (`hub | standalone`), `reason`, `occurredAt`.
- `reason` values:
  - `lease`: a grant or a newly observed holder.
  - `expiry`: this host took over an expired lease.
  - `release`: an operator release.
  - `delegation`: release because delegation ended.
  - `standalone`: a standalone verdict.
- Privacy: hashes only. Labels, Hub addresses, token paths, and hostnames never enter events. Labels appear only in the Hub lease row, private state, and local status.
- Failure meaning: an append failure leaves ownership intact and is retried at the next holder change. The fence, not the event, authorizes commits.

Resident failure codes and reasons: `convergence_owner_elsewhere`, `convergence_owner_unverifiable`, `convergence_owner_host_invalid`, `convergence_owner_transport_missing`, `convergence_owner_contended`, and `convergence_owner_released`. The Hub client reports every transport, status, identity, or body failure as `convergence_owner_hub_unavailable`, which means "not proven", never "held elsewhere".

Each Hub client failure also carries one closed cause code, such as `hub_forbidden` for a 403 answer, and the HTTP status where one exists. A verdict built from a failed request records them in the optional fence fields `failureCode` and `httpStatus`. Older fences without them stay readable. Only the code and status are kept; no message, URL, token, or token path. The [cross-host ownership specification](../../../specs/background-knowledge-convergence/runtime/ownership-and-activation/cross-host-ownership.md#hub-failure-causes) lists the codes and their remediations.

Publication keeps private state in `.lervo/state/knowledge/knowledge-publication.json`. The file is bounded, written with mode `0600`, and rebuildable from Git and GitHub. The optional `supersededCommits` lists at most 64 commits that a conflict superseded while the local branch kept them. Its `status` is one of:

- `idle`: nothing is unpublished.
- `awaiting_checks`: the pull request is open and its checks have not all finished. The resident looks again within two minutes.
- `open`: the pull request is open and merging is disabled.
- `merged`: the pull request merged and local `main` caught up.
- `local_diverged`: the pull request merged, but local `main` also holds other unpublished work, so it was left alone.
- `superseded`: the selected commits conflicted with the current remote base and were not published (step 5).
- `failed`: the last attempt failed.

A failure carries one of these codes:

- `knowledge_publication_fetch_failed`
- `knowledge_publication_scope_violation`
- `knowledge_publication_conflict`: replaying failed for a reason other than a content conflict.
- `knowledge_publication_push_failed`
- `knowledge_publication_pull_request_failed`
- `knowledge_publication_checks_failed`
- `knowledge_publication_merge_failed`
- `knowledge_publication_superseded`: recorded with status `superseded`.

Each failure also records a path-free detail, its first and last observation, and an occurrence count. Repeats of one code update a single record. `lervo operating attention` projects that record as one `knowledge_publication` item. It also projects an `unverifiable` or `contended` ownership verdict as one `knowledge_convergence_owner` item, which carries the verdict's `failureCode` and `httpStatus`. Its instruction names the remediation for that cause. A `superseded` publication is projected like a failure. A failure never undoes a push or a merge; the next cycle retries from current Git state. Publication adds no canonical event, because Git history and the pull request are the durable record.

## Consequences

- Mac and WSL can both host the Lervo resident. Exactly one converges and commits at a time, and either takes over without a person.
- A Hub-mode host without Hub access stays read-only after its lease ends and reports attention. It never double-owns silently.
- Settled knowledge reaches `origin/main` through one rolling pull request from whichever host owns convergence, and the owner's local `main` follows it after the merge.
- Conversation knowledge candidates queued on a non-owner wait. Forwarding them to the owner through the Hub remains ADR-0457 follow-up work.

## Deferred

- Binding the owner lease to the ADR-0456 writer lease once that lease is implemented.
- Peer-to-peer lease exchange over the replica SSH transport for Hub-less multi-host operation.
