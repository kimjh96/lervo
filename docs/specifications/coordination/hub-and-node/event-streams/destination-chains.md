# Destination chains

Each destination and project coordinate owns one canonical event hash chain; every event-producing Node therefore uses a distinct destination coordinate.

After registration, synchronization compares the Hub cursor with exact local history, queues a bounded prefix in that destination's durable outbox, and fails on mismatch. Local producers neither read Hub credentials nor wait for Node delivery.
