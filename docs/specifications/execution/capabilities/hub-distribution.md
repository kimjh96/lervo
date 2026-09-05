# Optional Hub distribution

Packages are never uploaded automatically. `capability publish` and `capability pull` create content-bound plans and require `--apply --approval <plan-hash>`.

Bearer values come from `LERVO_HUB_TOKEN` or another explicitly named environment variable. They never enter plans, receipts, manifests, locks, records, or errors.

Project publication binds an authorized destination and project. Public publication is separately explicit. `capability.publish` and `capability.read` are separate permissions.

Hub records store an immutable package envelope, scope, publisher principal ID, publication time, and a structured header containing content class, capability kind, manifest schema version, file count, total bytes, and secret exclusion.

Filesystem registries shard capability IDs by a deterministic two-hex digest. Same-content retries are idempotent; different content at one coordinate conflicts. Hub failure never invalidates local packages.
