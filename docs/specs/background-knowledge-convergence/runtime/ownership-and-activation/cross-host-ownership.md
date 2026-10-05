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
  }
}
```

- `hostLabel` matches `^[a-z0-9][a-z0-9-]{0,31}$`. It names the host to operators only.
- `coordination` is either `{ "mode": "standalone" }` or the Hub form above. The Hub principal behind the token needs `workspace.read` and `workspace.coordinate` for the project at `destinationId`. Every host of one repository must use the same Hub and `destinationId`.
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

`.lervo/state/knowledge/convergence-owner.json` holds `{ schemaVersion: 1, verdict, recordedHolderKey }`. The verdict records `role`, `reason`, `mode`, `hostHash`, `hostLabel`, `holder` (`hostHash`, `label`, `generation`, `expiresAt`), `validUntil`, `wakeAt`, `grantedAt`, `yieldUntil`, and `observedAt`. It is written atomically with mode `0600` before an observation returns.

- Commit authority: knowledge-output and freshness commits proceed only when the fence says `owner` and `validUntil` is in the future. A checkout with neither the host file nor the fence keeps legacy behavior. A host file without a fence refuses.
- Privacy: the fence holds hashes, labels, and timestamps; no Hub address or token path.
- Failure meaning: a missing or invalid fence on a configured host refuses commits until the next observation rewrites it.

## Resident behavior

The ownership role, holder, and generation are folded into the ADR-0461 fingerprint. A non-owner ignores due deliveries in the skip decision, because only the owner may claim them. Non-owner health:

| Role            | Health state | Reason                                                                                                       |
| --------------- | ------------ | ------------------------------------------------------------------------------------------------------------ |
| `waiting_owner` | `waiting`    | `waiting_owner:<holder label>`                                                                               |
| `ineligible`    | `waiting`    | `knowledge_authority_unavailable`                                                                            |
| `yielding`      | `waiting`    | `convergence_owner_released`                                                                                 |
| `unverifiable`  | `attention`  | `convergence_owner_unverifiable`, `convergence_owner_host_invalid`, or `convergence_owner_transport_missing` |
| `contended`     | `attention`  | `convergence_owner_contended`                                                                                |

A non-owner cycle returns `{ status: "waiting_owner", owner, convergence }`. `convergence` is the read-only debt status. `lervo knowledge convergence status` adds the fence verdict as `owner`. `lervo knowledge convergence owner status` prints the host hash, label, mode, and verdict without contacting the Hub, and never prints Hub coordinates. `lervo knowledge convergence owner release` releases a held Hub lease and yields.

## Replica coordination

Owner commits carry `Lervo-Convergence-Host: <hostHash>` and reach the other checkout through the replica coordinator. Host configuration, fence, delegation, and event stores sit under paths that capture excludes (`.lervo/state`, `.lervo/data`, `.lervo/knowledge/convergence-delegation.json`). Different owner state on each side therefore never makes snapshots differ.

To add a repository whose two checkouts both run residents:

1. Configure both hosts in `hub` mode against the same Hub and destination. Then confirm `lervo knowledge convergence owner status --json` shows one `owner` and one `waiting_owner` that names the other label.
2. Bring both checkouts to one commit on the same branch with clean tracked trees. Move commits with `git bundle` and fast-forward only, after `git cherry` shows that no unique commit would be lost.
3. Compare `node <node-runtime bin.js> repository-replica snapshot --root <root>` on both hosts; the `snapshotHash` values must be equal.
4. Remove any stale entry for the replica ID from the coordinator state file, add the repository with `conflictPolicy: "hold"`, and restart the coordinator. The first cycle must report `current`.
5. After the next owner commit, confirm both `HEAD`s are equal and that `git log --author=knowledge@lervo.invalid` shows the same trailer host on both.

A held divergence still records `repository.replica.diverged` once per identity under ADR-0456.
