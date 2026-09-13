# Capability packages

## Publication authority

Hub capability publication is an optional distribution surface, not a prerequisite for local execution. Project publications require an authorized destination and project coordinate; public publications remain explicitly selected. `capability.publish` and `capability.read` are separate bearer permissions.

## Content and storage

Immutable envelopes bind validated package content hash, scope, publisher principal, and publication time. Each record also has a verified structured header containing `capability_package`, package kind, manifest schema version, file count, total bytes, and `secretMaterial: excluded`. Filesystem storage uses deterministic two-hex ID sharding.

Documents use shared-context publication coordinates and CAS bytes; repository knowledge uses versioned OKF bundles. These content classes remain distinct and independently validated. Same-content retries are idempotent; different content at one ID and version conflicts. Hub storage and responses exclude bearer values and MCP credential values.
