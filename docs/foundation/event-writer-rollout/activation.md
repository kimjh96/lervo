# Event writer activation

Follow the [safety boundary](safety.md). The commands below default to version 2. For version 3, include `--schema-version 3` on both plan and apply and meet all version 3 reader and evidence requirements.

## Local-only activation

1. Stop repository writers. Use the repository's normal backup procedure to make the existing event database and writer coordinate, if present, recoverable.
2. Upgrade every local reader. Verify that `lervo trace --capabilities --json` advertises readable event schema versions including `[1, 2]` for version 2 or `[1, 2, 3]` for version 3.
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

## Hub-enabled repository without a Node

A Hub-enabled clone with no registered Node on its host follows the local-only steps. `lervo event-contract evidence` then reports `authority.kind: repository_node_absent_v1` and the local runtime as the only reader, because only a Node synchronizes events to the Hub. Retire or upgrade a stale registration for the repository first; any matching registration requires the full Hub-enabled flow below.

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
