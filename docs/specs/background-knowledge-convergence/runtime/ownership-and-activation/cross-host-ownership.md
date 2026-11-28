# Cross-host ownership

[ADR-0466](../../../../decisions/coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md) gives each repository identity exactly one convergence owner at a time, across every host that runs a resident or a CLI worker for it. This page defines the configuration, timing, private state, and the replica procedure.

## Host configuration

`.lervo/state/knowledge/convergence-owner-host.json` is host-local, mode `0600`, at most 4 KiB, and never tracked or replicated:

```json
{
  "schemaVersion": 1,
  "hostId": "hst_<32 lowercase hex>",
  "hostLabel": "mac",
  "coordination": {
    "mode": "hub",
    "hub": {
      "baseUrl": "https://hub.example/",
      "bearerTokenFile": "/absolute/owner-only/token",
      "destinationId": "hub:primary",
      "hubIdentityHash": "sha256:<64 hex>"
    }
  },
  "publication": {
    "remote": "origin",
    "baseBranch": "main",
    "branch": "lervo/knowledge-outputs",
    "merge": "when_checks_pass",
    "scope": "delegation"
  }
}
```

- `hostLabel` matches `^[a-z0-9][a-z0-9-]{0,31}$`. It names the host to operators only.
- `coordination` is either `{ "mode": "standalone" }` or the Hub form above. The Hub principal behind the token needs `workspace.read` and `workspace.coordinate`, or since ADR-0469 `sync.write`, for the project at `destinationId`. Every host of one repository must use the same Hub and `destinationId`.
- `publication` is optional; without it the owner never pushes. `merge` is `when_checks_pass` or `never`. The publication branch must differ from the base branch.
- Since [ADR-0473](../../../../decisions/knowledge/documents/0473-publish-knowledge-within-its-write-scope-and-never-rewrite-a-tool-generated-document.md), `scope: "delegation"` makes a path publishable when it is Lervo-managed knowledge state or lies within the active delegation's `canonicalRoots` or `normalizationRoots`. `allowedRoots` cannot accompany it. Without `scope`, `allowedRoots` holds 1 to 16 repository-relative prefixes ending in `/`, and defaults to `docs/` and `.lervo/knowledge/`. Derivation writes `scope: "delegation"`.
- Since [ADR-0596](../../../../decisions/knowledge/maintenance/0596-recover-knowledge-publication-from-failed-checks.md), optional `checks: { "ignore": [...] }` lists 1 to 8 exact commit status names, each 1 to 100 printable characters without repeats, that never block a merge. Check runs are never ignored. Unknown keys inside `publication` are ignored; known keys stay strictly validated. Only the operator writes it. Derivation keeps it and leaves it out of the configuration hash, so adding it does not make a derived file operator-owned. Every host that can own the repository needs the same list.
- A missing file is created as `standalone` with label `local` and a random `hostId` on the first observation. An invalid file yields `unverifiable / convergence_owner_host_invalid`; it never falls back to standalone.
- Under [ADR-0469](../../../../decisions/coordination/sync/0469-keep-background-knowledge-continuous-on-every-host.md), each resident derives this file from the Hub coordinates the host already uses for sync when Lervo owns it: absent, the legacy `standalone`/`local` default, or a file Lervo wrote. Hand-written files are never changed. See [fleet continuity](continuity.md#owner-host-derivation).

The CLI worker (`lervo knowledge worker --watch|--once`) and the Node resident child both compose the owner with the Hub HTTP client from `@lervo/sync`. Library callers that pass no owner keep the legacy single-host behavior.

## Timing

| Quantity                     | Value                                                             |
| ---------------------------- | ----------------------------------------------------------------- |
| Lease lifetime (Hub clock)   | 30 minutes                                                        |
| Owner heartbeat              | every 10 minutes; renews once a third of the lifetime has elapsed |
| Local validity               | request start + Hub-measured remaining lifetime − 60 seconds      |
| Waiting host wake            | holder's Hub expiry + 5 seconds, through `earliestAvailableAt`    |
| Yield after `owner release`  | 30 minutes                                                        |
| Standalone contention window | foreign knowledge commits newer than 30 minutes                   |

A resident observes ownership once per cycle (full or skipped) and in the owner heartbeat. One Hub request happens per observation at most, and none while a held lease is younger than its renewal point. ADR-0461 cadence (1 to 15 minutes) therefore bounds Hub traffic.

## Private fence

`.lervo/state/knowledge/convergence-owner.json` holds `{ schemaVersion: 1, verdict, recordedHolderKey }`. The verdict records `role`, `reason`, `mode`, `hostHash`, `hostLabel`, `holder` (`hostHash`, `label`, `generation`, `expiresAt`), `validUntil`, `wakeAt`, `grantedAt`, `yieldUntil`, and `observedAt`. A verdict built from a failed Hub request also records `failureCode` and `httpStatus`, such as `hub_forbidden` and `403`. Older fences without these fields stay valid. The fence is written atomically with mode `0600` before an observation returns.

- Commit authority: knowledge-output and freshness commits proceed only when the fence says `owner` and `validUntil` is in the future. A checkout with neither the host file nor the fence keeps legacy behavior. A host file without a fence refuses.
- Privacy: the fence holds hashes, labels, and timestamps; no Hub address or token path.
- Failure meaning: a missing or invalid fence on a configured host refuses commits until the next observation rewrites it.

## Hub failure causes

The Hub client attaches one cause to every failed lease request. The fence keeps only the code and the HTTP status; no error message, URL, token, or token path. `owner status` and the `knowledge_convergence_owner` attention item show both, with this remediation:

| `failureCode`               | Meaning                                                    | Remediation                                                                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hub_unauthorized`          | 401: the Hub did not accept the token                      | Replace the token in `bearerTokenFile` with a current credential for the project                                                                                                             |
| `hub_forbidden`             | 403: the principal lacks the project scope or a permission | Add the project ID at `destinationId` to the token principal's projects, with `sync.write` (ADR-0469) or `workspace.read` and `workspace.coordinate`; the client cannot see the principal ID |
| `hub_unreachable`           | No answer, a timeout, or a 5xx status                      | Check that `baseUrl` is reachable and the Hub is running                                                                                                                                     |
| `hub_identity_mismatch`     | The answer lacked the configured Hub identity              | Compare `hubIdentityHash` with the Hub's identity                                                                                                                                            |
| `hub_response_invalid`      | An unexpected status, content type, or body                | Check that the Hub runs a version with the owner lease                                                                                                                                       |
| `hub_configuration_invalid` | The coordinates or token cannot form a request             | Fix `baseUrl`, `destinationId`, `hubIdentityHash`, or the token                                                                                                                              |
| `token_file_unreadable`     | The token file could not be read safely                    | Make `bearerTokenFile` an owner-only (`0600`) regular file                                                                                                                                   |
| `hub_request_failed`        | A failure the client did not classify                      | Inspect the Hub configuration and reachability                                                                                                                                               |

A verdict built from a Hub answer, or from a held lease that needed no request, records no cause. A fence written before these fields existed reads as "no recorded cause".

## Resident behavior

The ownership role, holder, and generation are folded into the ADR-0461 fingerprint. A non-owner ignores due deliveries in the skip decision, because only the owner may claim them. Non-owner health:

| Role            | Health state | Reason                                                                                                       |
| --------------- | ------------ | ------------------------------------------------------------------------------------------------------------ |
| `waiting_owner` | `waiting`    | `waiting_owner:<holder label>`                                                                               |
| `ineligible`    | `waiting`    | `knowledge_authority_unavailable` or `provider_not_admitted`                                                 |
| `yielding`      | `waiting`    | `convergence_owner_released`                                                                                 |
| `unverifiable`  | `attention`  | `convergence_owner_unverifiable`, `convergence_owner_host_invalid`, or `convergence_owner_transport_missing` |
| `contended`     | `attention`  | `convergence_owner_contended`                                                                                |

A host is `ineligible` without an active delegation for its provider, as before, and also while its latest provider admission, recorded in `.lervo/state/knowledge/provider-clis.json` within the last hour, admitted none of the providers the delegation allows, as when its provider CLI is logged out. An owner that becomes ineligible releases its lease, records the change with reason `delegation`, and a peer that can do the work claims it. After that hour the record may be stale, so the host contends again; a claim that fails the same way records a fresh admission and yields once more.

The verdict names which cause applies. Without a usable delegation, its reason is `knowledge_authority_unavailable` and `wakeAt` is null, because only a delegation change restores eligibility. With a usable delegation but no admitted provider, its reason is `provider_not_admitted` and `wakeAt` is the moment the admission record turns one hour old. The resident wakes then like a non-owner waiting for a lease expiry, observes ownership again, and contends. Without that wake, a host whose provider was logged back in stayed `ineligible` until an unrelated change woke it, and every upgrade stage that needs the commit grant reported the stale verdict as `knowledge_authority_unavailable` although its delegation was active.

A non-owner cycle returns `{ status: "waiting_owner", owner, convergence }`. `convergence` is the read-only debt status. `lervo knowledge convergence status` adds the fence verdict as `owner`. `lervo knowledge convergence owner status` prints the host hash, label, mode, and verdict without contacting the Hub, and never prints the Hub address or token path. For an `unverifiable` or `contended` verdict it adds `remediation`, the exact next step for the recorded cause. For `hub_forbidden`, it names `workspace.read`, `workspace.coordinate`, the project ID, and the Hub destination to grant to the token's principal. The client cannot see the principal ID, so the instruction names the token instead. `lervo knowledge convergence owner release` releases a held Hub lease and yields.

## Publication

The owner's resident runs one publication after each cycle, as [ADR-0466](../../../../decisions/coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md#publication-to-the-shared-remote) defines. `lervo knowledge convergence owner publish [--json]` runs the same step once. The step makes no network call when no unpublished knowledge commit exists and no pull request is open or failed.

| Effect         | Command on the owner host                                                                        | Guard                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Repair         | `git checkout <restore-point> -- <path>` or removal, then one `Lervo Knowledge` commit           | Only paths whose newest commits are Lervo's own and that have no uncommitted edits (ADR-0473)                                                 |
| Fetch          | `git fetch <remote> +refs/heads/<base>:refs/remotes/<remote>/<base>` and the same for the branch | Host's own Git credential; `GIT_TERMINAL_PROMPT=0`                                                                                            |
| Policy         | `gh api` for the repository merge settings, the rules on both branches, and classic protection   | Before any push; a requirement Lervo cannot meet refuses with `knowledge_publication_policy_refused` (ADR-0603)                               |
| Replay         | `git worktree add --detach` on the remote base, then one `git cherry-pick` per commit            | Unless `HEAD` already descends from the remote base with only formatted knowledge commits; source committer date kept                         |
| Format         | The repository's Prettier in the replay worktree, then one `Lervo Knowledge` commit              | Only Prettier-owned paths the commits change or release; dated like the last source commit                                                    |
| Supersede      | `gh pr close`, `git update-ref refs/lervo/knowledge-superseded/<prefix>`, `git reset --keep`     | Only after a replay conflict; reset only on the base branch without developer work                                                            |
| Push           | `git push --force-with-lease=refs/heads/<branch>:<observed> <remote> <tip>:refs/heads/<branch>`  | Never the base branch; skipped when the remote branch carries the same trees on the current base                                              |
| Pull request   | `gh pr list`, `gh pr create --body-file -`, `gh pr edit --body-file -`                           | Host's own `gh` login; `GH_PROMPT_DISABLED=1`                                                                                                 |
| Rerun          | `gh run rerun <run> --failed`, or `gh pr close` then `gh pr reopen` when a run is too old        | Once per published head; only Actions jobs that never ran or did not finish (ADR-0596)                                                        |
| Merge          | `gh pr merge --<merge, squash, or rebase> --match-head-commit <head>`                            | `merge: when_checks_pass`; the method the policy allows; every check passed and every required one reported; the forge's merge state is ready |
| Local catch-up | `git merge --ff-only` or `git reset --keep`                                                      | On the base branch only; only when every path the local-only commits touched has the same bytes on the base                                   |

Before the fetch, the owner restores paths the knowledge lifecycle must not change, as [ADR-0473](../../../../decisions/knowledge/documents/0473-publish-knowledge-within-its-write-scope-and-never-rewrite-a-tool-generated-document.md#the-owner-repairs-its-own-commits) defines. These are tool-generated documents that recent `Lervo Knowledge` commits rewrote, even after publication, and unpublished paths outside the scope. The corrective commit carries one `Lervo-Publication-Repair` trailer per undone commit and records `knowledge.publication.repaired`. The scope check then refuses a path only when the last unpublished knowledge commit that changed it is not a repair commit, and the path is tool-generated or outside the scope. Its `knowledge_publication_scope_violation` detail names the repair blockers.

The publication state file, its statuses, and its failure codes are defined in the ADR. A replay conflict supersedes the selected commits:

- The open publication pull request is closed with a comment, because it carries only those commits. Its branch stays for the next push.
- `refs/lervo/knowledge-superseded/<first 12 hex of HEAD>` keeps the local head reachable. Only the eight newest backup refs are kept.
- When the base branch is checked out, still at the observed head, and holds no developer work, `git reset --keep` moves it to the remote base. The resident then runs its next cycle within five seconds. The moved head changes the source fingerprint, so convergence opens a new obligation and regenerates the outputs against the current base.
- Otherwise the branch is left for its owner to rebase, and the superseded commits are listed in `supersededCommits` (at most 64) so no later publication selects them again.
- In both cases the commits enter the [supersession ledger](knowledge-supersession.md) first, so every replicated checkout drops them too.
- The state becomes `superseded` with one `knowledge_publication_superseded` failure. Its path-free detail gives the conflicting path count, the commit count, whether the local base was reset, and the backup ref.

While the owner host's CLI release follower is paused, a CLI release train is between its cut and its tag. A merge then would move `main` and supersede the release's preparation, so the CLI publisher holds the merge as a gate wait with reason `release_train` and merges once the follower resumes. An unreadable follower control never holds. A Node-hosted publisher has no follower and is not held.

Identical input publishes once. Replay keeps source dates, so an unchanged series replays to the same hash. A remote branch that already holds the same trees on the current base is kept as the published head, so the next cycles only poll its checks. A merge that GitHub refuses because checks are still pending keeps `awaiting_checks`. Every `gh` failure records `gh <step> exit <code> <class>` as its detail:

- Steps: `find`, `create`, `update`, `view`, `close`, `checks`, `rerun`, `merge`, `policy`, `gate`, and `history`.
- Classes: `auth`, `rate_limited`, `network`, `not_found`, `not_mergeable`, `checks_pending`, `checks_failed`, `invalid_response`, `not_installed`, `method_not_allowed`, and `unknown`.
- The class comes from stderr, exit code, or a timeout. ADR-0603: GitHub's own reason follows the class after a colon, as one line of at most 200 characters with tokens and URL credentials redacted. It stays in this host's private publication state.
- `lervo knowledge convergence owner status` prints the detail with the state. The attention item carries it with a remediation for the `auth`, `network`, `not_installed`, `not_mergeable`, or `not_found` class.

Only checks that concluded `SUCCESS` count toward a merge. `SKIPPED` checks, such as release jobs a workflow runs only outside pull requests, neither pass nor block, and neither do commit statuses named in `checks.ignore`. At least one check must succeed. Every other finished conclusion fails the gate, including `NEUTRAL`, `CANCELLED`, `TIMED_OUT`, `STALE`, `STARTUP_FAILURE`, `ACTION_REQUIRED`, and status `ERROR` or `FAILURE`.

A failed gate names up to 8 failed checks with their conclusions in the failure detail, bounded to 480 characters. A failed Actions job without steps reports `not_run`. [ADR-0596](../../../../decisions/knowledge/maintenance/0596-recover-knowledge-publication-from-failed-checks.md) recovers a failed gate on an unchanged head:

- Check runs that concluded `not_run`, `cancelled`, `timed_out`, `startup_failure`, or `stale` start again once per published head, and the state returns to `awaiting_checks`. A real `failure` and an outside status are never rerun.
- When GitHub refuses every rerun only because the run is too old, the pull request is closed and reopened, which also fires the `closed` and `reopened` events. A failed reopen is tried once more; a pull request left closed is replaced by a new one after the wait.
- Otherwise no timer is armed. A cycle that runs for another reason reads the head again no sooner than 15 minutes, then 1 hour, then 6 hours after the last look. Before then the publisher makes no fetch and no forge call, so a remote base move or an outside push to the knowledge branch is noticed when the wait ends.
- A new knowledge commit, a moved local base, or a new published head ends the wait. The state's `checksRetry` records the head, the inventory digest, the attempt count, the next read, and whether the rerun happened.

[ADR-0603](../../../../decisions/knowledge/maintenance/0603-derive-knowledge-publication-from-repository-policy-and-judge-it-by-content.md) derives the merge method, the required checks, the up-to-date rule and the review requirement from the repository's own policy. It also judges publication by content, so a squash or rebase merge counts as published:

- GitHub is the source of truth for what is published. A local knowledge commit is published when its zero-context patch id is among the commits a merged pull request of the branch carried, read from GitHub's own `refs/pull/<n>/head`, and it was not built on that merge (its parent does not contain the merge commit), so a change regenerated after a revert publishes again, with no clock involved. Any host, including one with empty state, derives the same answer, with no cap, also for pull requests merged before records existed. A body record names the pushed head and carried commits, for people and for Lervo's closure mark, and never makes a commit published, so an edited record cannot drop a local commit. The history is read incrementally and cached per repository, with each settled pull request's patch ids; a merged pull request whose head GitHub does not serve fails by name, and a closed one is skipped.
- A merge counts once GitHub reports `MERGED`, even before it reports the merge commit; until then each cycle asks GitHub again.
- A knowledge commit is upstream when its patch is in the base or a merged pull request carried it. No content fallback remains.
- Every gh call targets the repository `publication.remote` names, on github.com or a GHES host, with an SSH host alias resolved by `ssh -G`; `ssh.github.com` is github.com, and another resolved host counts only when gh knows it. `gh api` endpoints get the owner and name filled in and `--hostname` off github.com; every other command gets `--repo`. A fork's pull request never counts.
- A pull request a person closed without merge is a decision. Lervo does not reopen it or publish its commits again, and reports `knowledge_publication_declined`. Lervo marks the records of pull requests it closes itself, and a close at most a minute after a deletion of the head branch is GitHub's, so neither is read as a decision.
- A base change of the newest merged publication is compared with its merge commit, on the paths it landed. A revert or a person's edit of a Lervo output is reported as `knowledge_publication_base_changed` and never republished. Formatting, squashes and edits of other paths are not changes. `lervo knowledge convergence owner acknowledge` ends both kinds of attention until something changes again.
- Waits on GitHub-side state follow ADR-0602. Checks that have not reported, only skipped checks, a stuck queue, a draft, a conflict, a blocked merge or the merge queue are read again after 2 minutes, doubling to 1 hour. A required review is read again after 15 minutes, then 1 hour. After that no timer is armed: `knowledge_publication_waiting` or `knowledge_publication_awaiting_review` is attention, and the pull request is read on the next cycle that runs for another reason. One wait is kept per pull request and carried commits, counting looks across kinds. A base move alone pushes nothing while the open head carries the same change; only a `behind` or `conflict` gate rebuilds it.
- A base that requires a merge queue, whether by rule or by classic protection, is entered through the queue.
- An unknown or unreadable rule or protection, an `update` rule on the base, or an unknown merge setting refuses by name before the push. A private repository whose plan has no rulesets or protection, which GitHub answers with 403 `Upgrade to GitHub Pro`, has none.
- A transient failure, including a rate limit, retries after 2 minutes, doubling to 1 hour, then on the next cycle. Transient failures count together whatever their codes. A policy refusal, a refused merge method or an authentication failure stays attention until a change.

A state that cannot be read is rebuilt from Git and GitHub at the next publication. `lervo knowledge convergence owner status` prints the publication settings and state. `lervo operating attention` shows at most one `knowledge_publication` item for the publication state and one for held superseded commits. It adds at most one `knowledge_convergence_owner` item for an `unverifiable` or `contended` verdict.

## Replica coordination

Owner commits carry `Lervo-Convergence-Host: <hostHash>` and reach the other checkout through the replica coordinator. Host configuration, fence, and event stores sit under paths that capture excludes (`.lervo/state`, `.lervo/data`). Different owner state on each side therefore never makes snapshots differ. Capture also excludes an untracked `.lervo/knowledge/convergence-delegation.json`. A delegation that `HEAD` tracks replicates with its worktree bytes, so the follower receives the owner's exact renewal ([ADR-0478](../../../../decisions/coordination/sync/0478-renew-each-delegation-with-one-writer.md)).

To add a repository whose two checkouts both run residents:

1. Configure both hosts in `hub` mode against the same Hub and destination. Then confirm `lervo knowledge convergence owner status --json` shows one `owner` and one `waiting_owner` that names the other label.
2. Bring both checkouts to one commit on the same branch with clean tracked trees. Move commits with `git bundle` and fast-forward only, after `git cherry` shows that no unique commit would be lost.
3. Compare `node <node-runtime bin.js> repository-replica snapshot --root <root>` on both hosts; the `snapshotHash` values must be equal.
4. Remove any stale entry for the replica ID from the coordinator state file, add the repository with `conflictPolicy: "hold"`, and restart the coordinator. The first cycle must report `current`.
5. After the next owner commit, confirm both `HEAD`s are equal and that `git log --author=knowledge@lervo.invalid` shows the same trailer host on both.

A divergence still records `repository.replica.diverged` once per identity under ADR-0456; under ADR-0561 the coordinator then saves the losing side to a backup branch and prefers the configured side, where `hold` prefers the local side. Before any history moves, every cycle drops superseded knowledge commits on both checkouts; see [knowledge supersession](knowledge-supersession.md).
