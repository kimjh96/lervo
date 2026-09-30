# Product observability

`product_observability.inspect` (v10), exposed by `application observability --work <work-id> --json`, adds `SurfaceObservabilityReportV1` for one managed work ID.

The CLI opens canonical storage read-only, verifies and freezes an exact event-chain head, reads at most 100,000 events from that prefix, and projects the existing `WorkExecutionReportV1`. It rejects a repository revision change during inspection.

The result preserves provider and causal resource scopes, every observed token dimension, cached-input tokens as a separate cache observation, the stage catalog and execution-profile coordinates, and terminal run state.

Grounding, search, verification, acceptance, artifact, publication, and delivery measurements remain explicitly unavailable or partial until their canonical readers are composed.

An optional origin coordinate can bind the same report to a Discord thread or future first-party surface without changing the underlying execution evidence.

The route grants no write, provider, approval, result-publication, delivery, or steering authority.
