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
    "allowedRoots": ["docs/", ".lervo/knowledge/"]
  }
}
```

- `hostLabel` matches `^[a-z0-9][a-z0-9-]{0,31}$`. It names the host to operators only.
- `coordination` is either `{ "mode": "standalone" }` or the Hub form above. The Hub principal behind the token needs `workspace.read` and `workspace.coordinate` for the project at `destinationId`. Every host of one repository must use the same Hub and `destinationId`.
- `publication` is optional; without it the owner never pushes. `merge` is `when_checks_pass` or `never`. `allowedRoots` holds 1 to 16 repository-relative prefixes ending in `/`, and defaults to `docs/` and `.lervo/knowledge/`. The publication branch must differ from the base branch.
- A missing file is created as `standalone` with label `local` and a random `hostId` on the first observation. An invalid file yields `unverifiable / convergence_owner_host_invalid`; it never falls back to standalone.

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

| `failureCode`               | Meaning                                                    | Remediation                                                                                                                                              |
| --------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hub_unauthorized`          | 401: the Hub did not accept the token                      | Replace the token in `bearerTokenFile` with a current credential for the project                                                                         |
| `hub_forbidden`             | 403: the principal lacks the project scope or a permission | Grant `workspace.read` and `workspace.coordinate` for the project ID at `destinationId` to the token's principal; the client cannot see the principal ID |
| `hub_unreachable`           | No answer, a timeout, or a 5xx status                      | Check that `baseUrl` is reachable and the Hub is running                                                                                                 |
| `hub_identity_mismatch`     | The answer lacked the configured Hub identity              | Compare `hubIdentityHash` with the Hub's identity                                                                                                        |
| `hub_response_invalid`      | An unexpected status, content type, or body                | Check that the Hub runs a version with the owner lease                                                                                                   |
| `hub_configuration_invalid` | The coordinates or token cannot form a request             | Fix `baseUrl`, `destinationId`, `hubIdentityHash`, or the token                                                                                          |
| `token_file_unreadable`     | The token file could not be read safely                    | Make `bearerTokenFile` an owner-only (`0600`) regular file                                                                                               |
| `hub_request_failed`        | A failure the client did not classify                      | Inspect the Hub configuration and reachability                                                                                                           |

A verdict built from a Hub answer, or from a held lease that needed no request, records no cause. A fence written before these fields existed reads as "no recorded cause".

## Resident behavior

The ownership role, holder, and generation are folded into the ADR-0461 fingerprint. A non-owner ignores due deliveries in the skip decision, because only the owner may claim them. Non-owner health:

| Role            | Health state | Reason                                                                                                       |
| --------------- | ------------ | ------------------------------------------------------------------------------------------------------------ |
| `waiting_owner` | `waiting`    | `waiting_owner:<holder label>`                                                                               |
| `ineligible`    | `waiting`    | `knowledge_authority_unavailable`                                                                            |
| `yielding`      | `waiting`    | `convergence_owner_released`                                                                                 |
| `unverifiable`  | `attention`  | `convergence_owner_unverifiable`, `convergence_owner_host_invalid`, or `convergence_owner_transport_missing` |
| `contended`     | `attention`  | `convergence_owner_contended`                                                                                |

A non-owner cycle returns `{ status: "waiting_owner", owner, convergence }`. `convergence` is the read-only debt status. `lervo knowledge convergence status` adds the fence verdict as `owner`. `lervo knowledge convergence owner status` prints the host hash, label, mode, and verdict without contacting the Hub, and never prints the Hub address or token path. For an `unverifiable` or `contended` verdict it adds `remediation`, the exact next step for the recorded cause. For `hub_forbidden`, it names `workspace.read`, `workspace.coordinate`, the project ID, and the Hub destination to grant to the token's principal. The client cannot see the principal ID, so the instruction names the token instead. `lervo knowledge convergence owner release` releases a held Hub lease and yields.

## Publication

The owner's resident runs one publication after each cycle, as [ADR-0466](../../../../decisions/coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md#publication-to-the-shared-remote) defines. `lervo knowledge convergence owner publish [--json]` runs the same step once. The step makes no network call when no unpublished knowledge commit exists and no pull request is open or failed.

| Effect         | Command on the owner host                                                                        | Guard                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Fetch          | `git fetch <remote> +refs/heads/<base>:refs/remotes/<remote>/<base>` and the same for the branch | Host's own Git credential; `GIT_TERMINAL_PROMPT=0`                                          |
| Replay         | `git worktree add --detach` on the remote base, then `git cherry-pick`                           | Unless `HEAD` already descends from the remote base with only knowledge commits             |
| Supersede      | `gh pr close`, `git update-ref refs/lervo/knowledge-superseded/<prefix>`, `git reset --keep`     | Only after a replay conflict; reset only on the base branch without developer work          |
| Push           | `git push --force-with-lease=refs/heads/<branch>:<observed> <remote> <tip>:refs/heads/<branch>`  | Never the base branch                                                                       |
| Pull request   | `gh pr list`, `gh pr create --body-file -`, `gh pr edit --body-file -`                           | Host's own `gh` login; `GH_PROMPT_DISABLED=1`                                               |
| Merge          | `gh pr merge --merge --match-head-commit <tip>`                                                  | `merge: when_checks_pass`, at least one check, all finished as success, neutral, or skipped |
| Local catch-up | `git merge --ff-only` or `git reset --keep`                                                      | On the base branch only; only when no local-only work is lost                               |

The publication state file, its statuses, and its failure codes are defined in the ADR. A replay conflict supersedes the selected commits:

- The open publication pull request is closed with a comment, because it carries only those commits. Its branch stays for the next push.
- `refs/lervo/knowledge-superseded/<first 12 hex of HEAD>` keeps the local head reachable. Only the eight newest backup refs are kept.
- When the base branch is checked out, still at the observed head, and holds no developer work, `git reset --keep` moves it to the remote base. The resident then runs its next cycle within five seconds. The moved head changes the source fingerprint, so convergence opens a new obligation and regenerates the outputs against the current base.
- Otherwise the branch is left for its owner to rebase, and the superseded commits are listed in `supersededCommits` (at most 64) so no later publication selects them again.
- The state becomes `superseded` with one `knowledge_publication_superseded` failure. Its path-free detail gives the conflicting path count, the commit count, whether the local base was reset, and the backup ref.

A state that cannot be read is rebuilt from Git and GitHub at the next publication. `lervo knowledge convergence owner status` prints the publication settings and state. `lervo operating attention` shows at most one `knowledge_publication` item, plus at most one `knowledge_convergence_owner` item for an `unverifiable` or `contended` verdict.

## Replica coordination

Owner commits carry `Lervo-Convergence-Host: <hostHash>` and reach the other checkout through the replica coordinator. Host configuration, fence, delegation, and event stores sit under paths that capture excludes (`.lervo/state`, `.lervo/data`, `.lervo/knowledge/convergence-delegation.json`). Different owner state on each side therefore never makes snapshots differ.

To add a repository whose two checkouts both run residents:

1. Configure both hosts in `hub` mode against the same Hub and destination. Then confirm `lervo knowledge convergence owner status --json` shows one `owner` and one `waiting_owner` that names the other label.
2. Bring both checkouts to one commit on the same branch with clean tracked trees. Move commits with `git bundle` and fast-forward only, after `git cherry` shows that no unique commit would be lost.
3. Compare `node <node-runtime bin.js> repository-replica snapshot --root <root>` on both hosts; the `snapshotHash` values must be equal.
4. Remove any stale entry for the replica ID from the coordinator state file, add the repository with `conflictPolicy: "hold"`, and restart the coordinator. The first cycle must report `current`.
5. After the next owner commit, confirm both `HEAD`s are equal and that `git log --author=knowledge@lervo.invalid` shows the same trailer host on both.

A held divergence still records `repository.replica.diverged` once per identity under ADR-0456.
