# Durable Apply and Recovery

The owner-only journal validates the plan and current bytes, stages outputs, backs up originals, publishes or deletes, lints, commits the event, then cleans backups and empty parents.

Pre-commit failure restores originals. Post-commit cleanup failure preserves outputs and requires recovery. Interrupted transactions block mutation. Rollback recreates only parents pruned by that transaction before restoring exact backups, including deleted shards and moved documents.

The adverse-condition safety specification defines the common effect inventory, exact completion/rollback/recovery projection, cancellation and backpressure bounds, telemetry field registry, threat model, capacity and retention profiles, and compatibility rehearsals. External uncertainty is never an automatic retry signal.
