# ADR-0466: Coordinate cross-host knowledge convergence with a Hub owner lease

Status: `accepted`
Decision date: 2026-10-05
Amends: [ADR-0457](../../knowledge/documents/0457-degrade-knowledge-intake-per-file-and-consolidate-documents.md) (one convergence owner across hosts), [ADR-0434](../../knowledge/repository/canonicalization/0434-converge-background-canonicalization-normalization-and-knowledge.md)
Related: [ADR-0456](0456-hand-off-repositories-atomically-with-a-writer-lease.md), [ADR-0461](../../operations/services/0461-drive-resident-runtime-service-work-from-changes-not-timers.md)

## Context

The Lervo repository runs delegated knowledge residents on Mac (`com.lervo.mac.knowledge`) and WSL (the Lervo Node's resident child). Each has its own clone, event store, delegation grant, and worker lock; both independently normalize, canonicalize, and commit `Lervo Knowledge` outputs. ADR-0434 requires one convergence owner per repository. ADR-0457 proposes binding ownership to the ADR-0456 writer lease or a delegation grant's `hostIdentityHash`, but neither exists in code: the lock is a PID file, the grant lacks host identity, and the writer lease is unimplemented.

The owner rejects a fixed "Mac only" rule. Work starts through Claude Code or Codex on Mac and Discord through the WSL Hub and Nodes, so either host must converge. Local execution without a Hub must remain available (invariant 1).

Repeated divergence removed the repository from Mac–WSL replica coordination. The Mac replica log recorded 6,940 `divergent` cycles across 1,047 distinct snapshot pairs and 81 `changed while current parity was being verified` failures; only three cycles reported conflicting paths. Most divergence came from both sides advancing between cycles: two residents produced knowledge outputs, developers committed on Mac, and Node turns wrote on WSL. Each cycle therefore found both sides beyond the common snapshot.

## Decision

### One owner lease per repository identity, hosted by the Hub

The Hub stores one convergence owner lease per destination, project, and repository identity hash (`projectId` plus `createdAt`, identical across clones). Hosts claim or release through `/v1/sync/projects/{projectId}/knowledge-convergence-owner` using `workspace.coordinate`; reads require `workspace.read`. The Hub applies one pure decision in a write transaction:

- A live holder's claim renews its lease.
- A claim against a vacant, released, or expired lease grants the next generation and reports the predecessor's ending (`expired` or `released`).
- Any other claim returns `held_elsewhere` with the live holder.
- Only the exact generation's holder can release.

The Hub clock determines expiry. A host converts the remaining Hub lifetime to local time from its request's start, subtracting a 60-second margin so host clock skew cannot create two live leases.

This is separate from ADR-0456's writer lease, which never expires silently because it guards human work. Background convergence must survive host death, so the owner lease expires after 30 minutes without renewal.

### Host identity and coordination mode

Each checkout stores host-local configuration in `.lervo/state/knowledge/convergence-owner-host.json`, ignored by Git and excluded from replica capture. It contains a random `hostId`, an operator label such as `mac` or `wsl`, and a mode:

- `hub`: the Hub lease decides ownership, configured with `baseUrl`, `bearerTokenFile`, `destinationId`, and `hubIdentityHash`.
- `standalone`: the default for an unconfigured host; convergence remains locally owned.

Only `hostHash = sha256("lervo.convergence-owner-host.v1\0" + hostId)` leaves the host. This replaces ADR-0457's delegation-grant `hostIdentityHash`; the grant remains host-local and unchanged.

### Roles

Each resident cycle and CLI worker run first resolves one verdict:

- `owner`: may converge and commit until local validity ends.
- `waiting_owner`: another host holds a live lease; health state `waiting`, reason `waiting_owner:<holder label>`.
- `unverifiable`: ownership cannot be proven because of a Hub outage without a live local lease, invalid host configuration, or missing transport; health state `attention`.
- `contended`: a standalone host found another host's knowledge commit from the last 30 minutes; health state `attention`.
- `ineligible`: a Hub-mode host lacks an active, unexpired delegation for its provider. It does not contend and releases any lease it held.
- `yielding`: an operator released this host's lease; it does not reclaim for 30 minutes.

Every non-owner runs only the read-only currency, normalization, and candidate debt inspection behind `lervo knowledge convergence status`. It records no baseline, calls no provider, writes no document, and claims no delivery. Queued change jobs wait until the host becomes owner. The owner's baseline discovery covers the same bytes once replicated.

### No commit without ownership

Every observation writes its verdict to the private fence `.lervo/state/knowledge/convergence-owner.json` before returning. `commitSettledKnowledgeOutputs` and the freshness commit consult it. A configured host commits only while its fence says `owner` within validity. A host with neither configuration nor fence retains legacy single-host behavior. Every owner commit carries `Lervo-Convergence-Host: <hostHash>`.

A heartbeat renews every 10 minutes, one third of the lease lifetime. If renewal reveals lost ownership, the resident aborts the running full cycle through the shutdown signal.

### No Hub

Invariant 1 holds through two modes:

- `standalone` requires no Hub. It scans bounded first-parent history for `Lervo Knowledge` commits with a different host trailer newer than one lease lifetime. Finding one records `contended` and stops commits until it ages out. Thus two unconfigured hosts surface attention after the first commit crosses between them.
- A `hub` host losing Hub access retains ownership only until its proven local lease ends. Without proof it records `unverifiable` and degrades explicitly; it never falls back to standalone.

### Deterministic handoff

Deploy restarts do not release the lease; the same host renews the same generation. A dead host hands over 30 minutes after its last renewal. A waiting host schedules its next cycle 5 seconds after the holder's Hub expiry using ADR-0461's `earliestAvailableAt`, without polling. Ownership role and holder enter the ADR-0461 change fence, ensuring one full cycle on ownership gain or loss.

Planned handoff uses `lervo knowledge convergence owner release`. The peer claims on its next cycle, within the 15-minute reconciliation ceiling.

### One history through replicas

Replica coordination transfers owner commits between checkouts through fast-forward pulls or pushes; non-overlapping concurrent work merges under ADR-0404. Owner identity, fence, and delegation remain in excluded paths and never replicate. The Lervo repository can rejoin replica coordination once both hosts use Hub-mode ownership; see the [cross-host ownership specification](../../../specs/background-knowledge-convergence/runtime/ownership-and-activation/cross-host-ownership.md) for the procedure.

### Publication to the shared remote

Replication transferred commits between checkouts but did not publish to GitHub. ADR-0465 batch-boundary commits accumulated on Mac's local `main` until a person opened pull requests; other merges then diverged local `main` from `origin/main`.

After every resident cycle, the owner publishes settled commits only while its fence grants `owner` and its host configuration contains a `publication` block:

1. Fetch the base and publication branches from the configured remote using the host's Git credentials.
2. Select unpublished knowledge commits in `remote/base..HEAD`: non-merge commits authored and committed by `Lervo Knowledge` whose patches are not upstream according to `git cherry`. Every other commit is other work and is never published.
3. Refuse the entire publication if any selected commit changes a path outside the allowed roots (default `docs/` and `.lervo/knowledge/`).
4. Use `HEAD` as the publication tip if `base..HEAD` contains only selected commits. Otherwise replay selected commits onto the remote base in a temporary worktree; a replay conflict refuses publication.
5. Push the tip to one rolling branch (default `lervo/knowledge-outputs`) using `--force-with-lease` against its observed head. Never push the base branch.
6. Open or update one pull request through the host's authenticated `gh` CLI, titled `docs: publish reviewed background knowledge`. Follow `.github/PULL_REQUEST_TEMPLATE.md` section by section, starting at H2. Check only items the publisher verified and explain every unchecked item.
7. With `merge: when_checks_pass`, merge with a merge commit through `--match-head-commit` once every reported check on that exact head succeeds. With `merge: never`, stop at the open pull request. GitHub auto-merge is disabled for this repository, and no rule forbids automated merging, so the publisher checks CI itself.
8. After merging, advance local `main` to the remote base only when no work can be lost. Fast-forward if `HEAD` is an ancestor of the base. If every local-only commit is a non-merge patch already upstream, use `reset --keep`, preserving uncommitted edits. Otherwise leave local `main` unchanged and record `local_diverged`.

The host's reviewed delegation and live owner lease authorize these writes. Delegation authorizes convergence commits; the publication block is the operator's opt-in to pushing and merging them. Developer work never enters the publication branch, preserving invariant 5.

## Events, states, and failure meaning

The observing host appends `knowledge.convergence.owner.changed` (event schema 4) to its own event store whenever its observed holder changes and when it ends its own holding.

Required fields are `repositoryIdentityHash`, `holderHostHash` or null, `previousHolderHostHash` or null, `observerHostHash`, `generation` or null (null in standalone mode and on release), `mode` (`hub | standalone`), `reason`, and `occurredAt`.

The `reason` values are:

- `lease`: a grant or newly observed holder.
- `expiry`: this host took over an expired lease.
- `release`: operator release.
- `delegation`: release because delegation ended.
- `standalone`: a standalone verdict.

Events contain hashes only: labels, Hub addresses, token paths, and hostnames are excluded. Labels appear only in the Hub lease row, private state, and local status. An append failure leaves ownership intact and is retried at the next holder change. The fence, not the event, authorizes commits.

Resident failure codes and reasons are `convergence_owner_elsewhere`, `convergence_owner_unverifiable`, `convergence_owner_host_invalid`, `convergence_owner_transport_missing`, `convergence_owner_contended`, and `convergence_owner_released`. The Hub client maps every transport, status, identity, or body failure to `convergence_owner_hub_unavailable`, meaning "not proven", never "held elsewhere".

Publication stores private state in `.lervo/state/knowledge/knowledge-publication.json`. The file is bounded, written with mode `0600`, and rebuildable from Git and GitHub. Its `status` is:

- `idle`: nothing is unpublished.
- `awaiting_checks`: the pull request is open and checks have not all finished; the resident checks again within two minutes.
- `open`: the pull request is open and merging is disabled.
- `merged`: the pull request merged and local `main` caught up.
- `local_diverged`: the pull request merged, but local `main` has other unpublished work and was left unchanged.
- `failed`: the last attempt failed.

Publication failures use one of:

- `knowledge_publication_fetch_failed`
- `knowledge_publication_scope_violation`
- `knowledge_publication_conflict`
- `knowledge_publication_push_failed`
- `knowledge_publication_pull_request_failed`
- `knowledge_publication_checks_failed`
- `knowledge_publication_merge_failed`

Each failure records path-free detail, first and last observations, and an occurrence count; repeated occurrences of a code update one record. `lervo operating attention` projects that record as one `knowledge_publication` item, and an `unverifiable` or `contended` ownership verdict as one `knowledge_convergence_owner` item. Failures never undo pushes or merges; the next cycle retries from current Git state. Publication adds no canonical event: Git history and the pull request are its durable record.

## Consequences

- Mac and WSL can both host the resident. Exactly one converges and commits at a time; either takes over without a person.
- A Hub-mode host without Hub access becomes read-only after lease expiry and reports attention, never silently double-owning.
- Settled knowledge reaches `origin/main` through one rolling pull request from the owner, whose local `main` follows after merge.
- Conversation knowledge candidates queued on non-owners wait. Hub forwarding to the owner remains ADR-0457 follow-up work.

## Deferred

- Bind ownership to the ADR-0456 writer lease once implemented.
- Exchange leases peer-to-peer over replica SSH for Hub-less multi-host operation.
