# Event streams

## Destination chains

Each destination and project coordinate owns one canonical event hash chain; every event-producing Node therefore uses a distinct destination coordinate. After registration, synchronization compares the Hub cursor with exact local history, queues a bounded prefix in that destination's durable outbox, and fails on mismatch. Local producers neither read Hub credentials nor wait for Node delivery.

## Reader compatibility

Reader compatibility is advertised separately from registration and writer selection. The local trace surface, owner-only Node health snapshot, and Hub `GET /v1/health/capabilities` return the same `EventReaderCapabilitiesV1` meaning. The sync transport authenticates Hub identity before trusting the body and does not send the bearer secret to this unauthenticated endpoint.

The report contains only its schema, the fixed `event_reader` capability name, and ascending readable event-schema versions. It grants no write or rollout authority. A missing, invalid, unverified, or v2-incapable peer report blocks future v2 writer activation without disabling local execution or current v1 synchronization.

## Hub-enabled writer activation

The owner-only repository Node fleet registry is the configured membership authority. Its one project registration binds the installed service and owner-only runtime config, which identify the Node health file and one Hub destination. Node health additively binds event-reader capability to project, repository identity, and destination.

Planning and apply each require an exact current three-reader set: local runtime, registered Node, and configured Hub. Activation evidence contains source and peer hashes but excludes paths, URLs, service bodies, bearer paths or bytes, and credentials.

See [ADR-0332 in the coordination references](../hub-and-node.md#references).
