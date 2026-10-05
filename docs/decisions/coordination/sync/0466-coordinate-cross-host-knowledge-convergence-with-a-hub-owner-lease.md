# ADR-0466: Coordinate cross-host knowledge convergence with a Hub owner lease

Status: `accepted`
Decision date: 2026-10-05
Amends: [ADR-0457](../../knowledge/documents/0457-degrade-knowledge-intake-per-file-and-consolidate-documents.md) (one convergence owner across hosts), [ADR-0434](../../knowledge/repository/canonicalization/0434-converge-background-canonicalization-normalization-and-knowledge.md)
Related: [ADR-0456](0456-hand-off-repositories-atomically-with-a-writer-lease.md), [ADR-0461](../../operations/services/0461-drive-resident-runtime-service-work-from-changes-not-timers.md)
Amended by: [ADR-0468](0468-propagate-knowledge-supersession-across-replicated-checkouts.md) (supersession across replicated checkouts)

## Context

The Lervo repository runs delegated knowledge residents concurrently on Mac (`com.lervo.mac.knowledge`) and WSL (the Lervo Node's resident child). Each host has its own clone, event store, delegation grant, and worker lock, and independently normalizes, canonicalizes, and commits `Lervo Knowledge` outputs. ADR-0434 requires one convergence owner per repository. ADR-0457 proposed binding ownership to the ADR-0456 writer lease or a delegation-grant `hostIdentityHash`; neither is implemented. The worker lock is a PID file, the grant lacks host identity, and no writer lease exists.

The owner rejects fixed Mac-only ownership: work starts through Claude Code or Codex on Mac and through Discord, the WSL Hub, and Nodes. Either host must converge, and local execution without a Hub must remain possible (invariant 1).

Repeated divergence removed the repository from Mac–WSL replica coordination. Mac logs show 6,940 `divergent` cycles across 1,047 distinct snapshot pairs and 81 `changed while current parity was being verified` failures; only three cycles reported conflicting paths. Most divergence reflected both sides advancing beyond the common snapshot: both residents produced outputs, developers committed on Mac, and Node turns wrote on WSL.

## Decision

### One owner lease per repository identity, hosted by the Hub

The Hub stores one convergence owner lease per destination, project, and repository identity hash (`projectId` plus `createdAt`, identical across clones). Hosts claim or release through `/v1/sync/projects/{projectId}/knowledge-convergence-owner` using `workspace.coordinate`; reads require `workspace.read`. One pure decision runs inside a Hub write transaction:

- The live holder's claim renews its lease.
- A claim against a vacant, released, or expired lease grants the next generation and reports whether the predecessor `expired` or was `released`.
- Any other claim returns `held_elsewhere` and the live holder.
- Only the holder of the exact generation can release.

The Hub clock determines expiry. Hosts convert remaining Hub lifetime to local time from request start, subtracting a 60-second margin so host clock skew cannot create two live leases.

Unlike ADR-0456's writer lease, which never expires silently because it protects human work, the background convergence owner lease expires after 30 minutes without renewal to survive host death.

### Host identity and coordination mode

Each checkout stores host-local configuration in `.lervo/state/knowledge/convergence-owner-host.json`, ignored by Git and excluded from replica capture. It contains a random `hostId`, an operator label such as `mac` or `wsl`, and a mode:

- `hub`: ownership comes from the Hub lease, configured by `baseUrl`, `bearerTokenFile`, `destinationId`, and `hubIdentityHash`.
- `standalone`: default for unconfigured hosts; convergence remains locally owned.

Only `hostHash = sha256("lervo.convergence-owner-host.v1\0" + hostId)` leaves the host. This replaces ADR-0457's delegation-grant `hostIdentityHash`; the grant remains host-local and unchanged.

### Roles

Every resident cycle and CLI worker run first resolves a verdict:

- `owner`: may converge and commit until local validity ends.
- `waiting_owner`: another host has a live lease; health state `waiting`, reason `waiting_owner:<holder label>`.
- `unverifiable`: ownership cannot be proven because of a Hub outage without a live local lease, invalid host configuration, or missing transport; health state `attention`. Failed Hub requests also supply `failureCode` and `httpStatus` as defined below.
- `contended`: a standalone host found another host's knowledge commit from the last 30 minutes; health state `attention`.
- `ineligible`: a Hub-mode host lacks an active, unexpired delegation for its provider. It does not contend and releases any lease it held.
- `yielding`: an operator released this host's lease; it does not reclaim for 30 minutes.

All non-owners run only the read-only currency, normalization, and candidate debt inspection behind `lervo knowledge convergence status`. They record no baseline, call no provider, write no document, and claim no delivery. Queued change jobs wait for ownership; the owner's baseline discovery covers the same bytes after replication.

### No commit without ownership

Every observation writes its verdict to the private fence `.lervo/state/knowledge/convergence-owner.json` before returning. `commitSettledKnowledgeOutputs` and the freshness commit consult it. Configured hosts commit only with a valid `owner` fence. Hosts with neither configuration nor fence retain legacy single-host behavior. Every owner commit includes `Lervo-Convergence-Host: <hostHash>`.

A heartbeat renews every 10 minutes, one-third of the lease lifetime. If renewal shows lost ownership, the resident aborts the running full cycle using the shutdown signal.

### No Hub

Invariant 1 holds as follows:

- `standalone` needs no Hub. It checks bounded first-parent history for `Lervo Knowledge` commits with another host's trailer newer than one lease lifetime. A match records `contended` and blocks commits until it ages out. Two unconfigured hosts therefore surface attention after the first commit crosses between them.
- A `hub` host losing Hub access remains owner only until its locally proven lease ends. Without proof, it records `unverifiable` and degrades explicitly; it never falls back to standalone.

### Deterministic handoff

Deploy restarts do not release ownership: the same host renews the same generation. A dead host hands over 30 minutes after its last renewal. A waiting host schedules its next cycle 5 seconds after the holder's Hub expiry using ADR-0461's `earliestAvailableAt`, without polling. Role and holder enter the ADR-0461 change fence, ensuring that gaining or losing ownership runs one full cycle.

For planned handoff, `lervo knowledge convergence owner release` releases ownership. The peer claims on its next cycle, within the 15-minute reconciliation ceiling.

### One history through replicas

The replica coordinator moves owner commits between checkouts through fast-forward pulls or pushes; non-overlapping concurrent work merges under ADR-0404. Owner identity, fence, and delegation remain in excluded paths and never replicate. The repository can rejoin replica coordination once both hosts use Hub-mode ownership; the [cross-host ownership specification](../../../specs/background-knowledge-convergence/runtime/ownership-and-activation/cross-host-ownership.md) defines the procedure.

### Publication to the shared remote

Replication moved owner commits between checkouts without publishing to GitHub. ADR-0465 batch-boundary commits accumulated on Mac's local `main`, requiring manual pull requests; other merges then caused divergence from `origin/main`.

After every resident cycle, the owner publishes settled commits only while its fence grants `owner` and its host configuration contains a `publication` block:

1. Fetch the base and publication branches from the configured remote using the host's Git credentials.
2. Select unpublished knowledge commits in `remote/base..HEAD`: non-merge commits authored and committed by `Lervo Knowledge` whose patches are not already upstream according to `git cherry`. All other commits count as other work and are never published.
3. Refuse the entire publication if any selected commit changes a path outside allowed roots (defaults: `docs/` and `.lervo/knowledge/`).
4. Build the publication tip on the current remote base. Use `HEAD` only if it descends from that base, `base..HEAD` contains only selected commits, and every Prettier-owned path they change or release is already formatted. Otherwise replay selected commits onto the remote base in a temporary worktree, including when a knowledge-only local branch has an older base. Replay keeps source dates, so identical input yields identical hashes. With Prettier, one dated `Lervo Knowledge` commit formats the paths the commits change or release; lifecycle-owned bytes stay exact.
5. A replay content conflict means outputs used stale source bytes; never publish those commits. Close the open publication pull request and preserve local head under a backup ref. If the local base branch is checked out and contains no developer work, move it to the remote base with `reset --keep`; the next cycle regenerates outputs. Otherwise record the superseded commits and never select them again. Record status `superseded` and the conflicting path count. Either way, the commits enter a supersession ledger carried by the replica so every checkout drops them ([ADR-0468](0468-propagate-knowledge-supersession-across-replicated-checkouts.md)).
6. Push the tip to one rolling branch (default `lervo/knowledge-outputs`) using `--force-with-lease` against the observed branch head. Never push the base branch. Skip the push and keep the remote head when it carries the same commit trees on the current base, so unchanged content never restarts CI.
7. Open or update one pull request through the host's authenticated `gh` CLI. Never reuse a pull request closed outside the publisher; open a new one at the next publication. Use title `docs: publish reviewed background knowledge` and follow `.github/PULL_REQUEST_TEMPLATE.md` section by section, starting at H2. Check only items the publisher verified itself and explain every unchecked item.
8. With `merge: when_checks_pass`, merge with a merge commit using `--match-head-commit` only after every check on that exact head concluded success; skipped checks neither pass nor block, and at least one must succeed. Any other conclusion, including neutral and cancelled, records `knowledge_publication_checks_failed`. A merge refused for pending checks stays `awaiting_checks`. With `merge: never`, stop at the open pull request. Without branch protection or auto-merge, this gate is the only merge guard.
9. After merging, update local `main` to the remote base only without losing work. Fast-forward if `HEAD` is an ancestor of the base. If every local-only commit is a non-merge patch already upstream, use `reset --keep`, preserving uncommitted edits. Otherwise leave local `main` unchanged and record `local_diverged`.

The owner also [formats settled outputs before committing](../../../specs/background-knowledge-convergence/runtime/reviewed-output-commits/output-selection-and-git-mutation.md#formatting-before-the-commit); step 4 covers older commits and other commit paths.

The reviewed host delegation plus live owner lease authorizes these writes. Delegation authorizes convergence commits; the publication block is the operator's opt-in for pushing and merging. Developer work never enters the publication branch, preserving invariant 5.

## Events, states, and failure meaning

`knowledge.convergence.owner.changed` (event schema 4) is appended to the observing host's event store whenever its observed holder changes or it ends its own holding.

- Required fields: `repositoryIdentityHash`, `holderHostHash` or null, `previousHolderHostHash` or null, `observerHostHash`, `generation` or null (null in standalone mode and on release), `mode` (`hub | standalone`), `reason`, `occurredAt`.
- Reasons: `lease` for a grant or newly observed holder; `expiry` for taking over an expired lease; `release` for operator release; `delegation` for release because delegation ended; `standalone` for a standalone verdict.
- Privacy: hashes only. Labels, Hub addresses, token paths, and hostnames never enter events. Labels appear only in the Hub lease row, private state, and local status.
- Append failure leaves ownership intact and is retried at the next holder change. The fence, not the event, authorizes commits.

Resident failure codes and reasons are `convergence_owner_elsewhere`, `convergence_owner_unverifiable`, `convergence_owner_host_invalid`, `convergence_owner_transport_missing`, `convergence_owner_contended`, and `convergence_owner_released`. All Hub transport, status, identity, or body failures report `convergence_owner_hub_unavailable`: ownership is "not proven", never "held elsewhere".

Each Hub client failure also carries one closed cause code, such as `hub_forbidden` for HTTP 403, plus HTTP status when available. Failed-request verdicts record these in optional fence fields `failureCode` and `httpStatus`; older fences remain readable. Store only code and status, never a message, URL, token, or token path. See [Hub failure causes and remediations](../../../specs/background-knowledge-convergence/runtime/ownership-and-activation/cross-host-ownership.md#hub-failure-causes).

Publication private state lives in `.lervo/state/knowledge/knowledge-publication.json`: bounded, written with mode `0600`, and rebuildable from Git and GitHub. Optional `supersededCommits` contains at most 64 conflict-superseded commits retained on the local branch. Status values:

- `idle`: nothing unpublished.
- `awaiting_checks`: the pull request is open and checks are not all finished; the resident checks again within two minutes.
- `open`: the pull request is open and merging is disabled.
- `merged`: the pull request merged and local `main` caught up.
- `local_diverged`: the pull request merged, but local `main` contains other unpublished work and was left unchanged.
- `superseded`: selected commits conflicted with the current remote base and were not published (step 5).
- `failed`: the last attempt failed.

Publication failure codes:

- `knowledge_publication_fetch_failed`
- `knowledge_publication_scope_violation`
- `knowledge_publication_conflict`: replay failed for a reason other than a content conflict.
- `knowledge_publication_push_failed`
- `knowledge_publication_pull_request_failed`
- `knowledge_publication_checks_failed`
- `knowledge_publication_merge_failed`
- `knowledge_publication_superseded`: recorded with status `superseded`.

Each failure records a path-free detail, first and last observation, and occurrence count; repeats of the same code update one record. Details are `git <stage> exit <code>` or `gh <step> exit <code> <class>`, with a closed class derived from stderr; stderr itself is never stored. The [specification](../../../specs/background-knowledge-convergence/runtime/ownership-and-activation/cross-host-ownership.md#publication) lists steps and classes. `lervo operating attention` projects it as one `knowledge_publication` item, including `superseded` publications as failures. It also projects an `unverifiable` or `contended` verdict as one `knowledge_convergence_owner` item carrying `failureCode` and `httpStatus`, with an instruction naming the cause's remediation.

Failures never undo a push or merge; the next cycle retries from current Git state. Publication adds no canonical event: Git history and the pull request are the durable record.

## Consequences

- Mac and WSL can both host the resident; exactly one converges and commits at a time, and either takes over without human intervention.
- A Hub-mode host without Hub access becomes read-only after lease expiry and reports attention; it never silently double-owns.
- Settled knowledge reaches `origin/main` through one rolling pull request from the current owner, whose local `main` follows after merge.
- Conversation knowledge candidates queued on non-owners wait; forwarding through the Hub remains ADR-0457 follow-up work.

## Deferred

- Bind the owner lease to the ADR-0456 writer lease once implemented.
- Peer-to-peer lease exchange over replica SSH for Hub-less multi-host operation.
