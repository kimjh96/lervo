# Event writer reader-first rollout

Status: `active`

As of: 2026-09-01

## Safety boundary

Envelope version 2 writing is repository-local, off by default, and selected only by the Lervo-managed `.lervo/data/event-contract.json` coordinate. A missing coordinate selects version 1. Activation affects future writes only and never rewrites event history.

Before activation, every process that can read the repository event chain must use a version 2-capable reader. After any version 2 event exists, mixed history makes version 1-only readers unsafe even if the writer returns to version 1. Readers must therefore remain version 2-capable through writer rollback.

For Hub-enabled repositories, the owner-only repository Node fleet registry is the configured membership authority. The installed service definition locates the Node config. Fresh identity-bound Node health and the configured Hub capability endpoint are the required remote observations. Do not disable Hub synchronization to bypass this gate.

## Local-only activation

1. Stop repository writers. Make the existing event database and writer coordinate, if present, recoverable using the repository's normal backup procedure.
2. Upgrade every local reader. Verify that `lervo trace --capabilities --json` advertises readable event schema versions `[1, 2]`.
3. Capture bounded, secret-free local evidence once:

   ```text
   lervo event-contract evidence --json > event-reader-evidence.json
   ```

4. Produce a read-only plan. Inspect its `status`, blockers, current hash, desired hash, and exact `planId`:

   ```text
   lervo event-contract activate --from event-reader-evidence.json --json
   ```

5. Apply only that exact current plan ID using the same evidence bytes:

   ```text
   lervo event-contract activate --from event-reader-evidence.json --apply <plan-id> --json
   ```

6. Verify `lervo event-contract status --json`, append through an ordinary managed path, and replay the complete mixed chain before restarting concurrent writers.

Evidence creation, planning, and apply are separate operations. A changed manifest, coordinate, capability bundle, or evidence file makes the plan stale before mutation.

## Hub-enabled activation

1. Upgrade the local CLI, registered repository Node, and Hub to version 2-capable readers. Keep the registered Node running so its owner-only health snapshot is no older than two minutes.
2. Verify that `lervo repository node status --json` names the expected project, destination, and service, and reports advancing health. Repair or reconcile stale fleet and service state before continuing.
3. Capture one authoritative, bounded, secret-free observation. This reads the public Hub capability endpoint without loading or sending its bearer credential:

   ```text
   lervo event-contract evidence --json > event-reader-evidence.json
   ```

4. Produce and inspect the exact plan:

   ```text
   lervo event-contract activate --from event-reader-evidence.json --json
   ```

5. Apply that plan ID using the same evidence file:

   ```text
   lervo event-contract activate --from event-reader-evidence.json --apply <plan-id> --json
   ```

Both plan and apply re-observe the fleet registry, service definition, runtime config, Node health, and Hub identity-bound capability. A different member, coordinate, source hash, identity, or capability, or a stale Node observation, fails before coordinate mutation. The evidence file exposes only hashes and reader reports—never local paths, service bodies, URLs, or credentials.

## Writer rollback

Using the same version 2-capable release, plan and apply a return to version 1 writing:

```text
lervo event-contract rollback --json
lervo event-contract rollback --apply <plan-id> --json
```

Verify that status selects version 1, then replay the complete mixed chain. Keep all readers version 2-capable. Rollback proves only the future writer selection; it neither removes version 2 events nor reverses another deployment or proves Node and Hub health.

Before writer activation, a failed reader deployment may return to the previous version 1-only release because no version 2 history exists. After activation, deploy a fixed version 2-capable reader instead.

## Interrupted apply

A pending owner-only transaction blocks status, new plans, and ordinary project storage. Run explicit recovery:

```text
lervo event-contract recover --json
```

Recovery reports exact `completed`, exact `rolled_back`, or fails with `event_writer_recovery_required`. It never guesses from a missing response. Before resuming writers, run status and replay the full chain.
