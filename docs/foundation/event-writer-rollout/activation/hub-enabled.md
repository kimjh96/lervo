# Hub-enabled activation

Follow the [activation requirements](../activation.md), including the version 3 requirements when applicable.

1. Upgrade the local CLI, registered repository Node, and Hub to version 2-capable readers. Keep the registered Node running so its owner-only health snapshot is no older than two minutes.
2. Verify the configured reader membership: the local runtime, registered repository Node, and configured Hub. The owner-only repository Node fleet registry is the membership authority; its registration binds the installed service and runtime configuration. Repair or reconcile stale fleet and service state before continuing.
3. Capture one authoritative, bounded, secret-free observation. The public, identity-bound Hub capability request does not send the bearer credential:

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

## Through `lervo upgrade`

The upgrade's `event_writer` stage runs steps 3 through 5 after the Node stage and the terminal hook runtime are current ([ADR-0470](../../../decisions/operations/services/0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md)). It writes the same backup as [local-only activation](local-only.md#automatic-activation). A failed observation does not activate; it blocks the stage with its code and remedy, for example `reader_inventory_hub_unavailable`. After activation, the Node's held knowledge resident resumes within a minute without a Node restart.
