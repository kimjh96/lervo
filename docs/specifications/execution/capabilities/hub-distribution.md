# Optional Hub distribution

Packages are never uploaded automatically. [ADR-0560](../../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md) removed the `lervo capability publish` and `lervo capability pull` commands and their HTTP client; the Hub capability endpoint and registry below remain, and local install from a package directory stays the supported path.

Bearer values never enter receipts, manifests, locks, records, or errors.

Project publication binds an authorized destination and project. Public publication is separately explicit. `capability.publish` and `capability.read` are separate permissions.

Hub records store an immutable package envelope, scope, publisher principal ID, publication time, and a structured header containing content class, capability kind, manifest schema version, file count, total bytes, and secret exclusion.

Filesystem registries shard capability IDs by a deterministic two-hex digest. Same-content retries are idempotent; different content at one coordinate conflicts. Hub failure never invalidates local packages.
