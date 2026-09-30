# Hub-enabled activation

Follow the [activation requirements](../activation.md), including the version 3 requirements when applicable.

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

Both plan and apply re-observe the fleet registry, service definition, runtime config, Node health, and Hub identity-bound capability. A different member, coordinate, source hash, identity, or capability, or a stale Node observation, fails before coordinate mutation.

The evidence file exposes only hashes and reader reports—never local paths, service bodies, URLs, or credentials.
