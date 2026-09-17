# `SurfaceObservabilityReportV1`

Required top-level fields:

- `schemaVersion: 1` and `kind: product_surface.observability`;
- surface kind and adapter build;
- source event-head hash, repository revision, nullable work and origin coordinates;
- grounding, search, resources, stages, caches, result, and completeness sections;
- an exact report digest over the ordered projection.

Each section carries its own `complete`, `partial`, `unavailable`, or `invalid` status and typed reason. Section state is never rewritten. Report status is:

- `complete` only when every required section is complete;
- `invalid` when any required section is invalid;
- `unavailable` when no required section has usable evidence;
- otherwise `partial`.

Resource groups retain provider, causal scope, accounting mode, and descriptor hash. Cache entries require a cache kind, owner, unit, observed value or explicit unavailable state, source revision, adapter or compiler build, and cold or warm disposition where defined.

Privacy and failure meanings follow [surface observability](../observability.md). The report never converts unavailable observations to zero or combines unlike cache units.

Grounding document counts are nullable independently. Coverage with a known value requires integer numerator and denominator; unavailable coverage requires a null denominator and value plus a reason, while a separately observed numerator may remain present. This prevents an unavailable denominator or unobserved document stage from being serialized as zero.

## Managed-work projector

`@lervo/product-surface-projection` projects an existing `WorkExecutionReportV1` without re-reading provider output or inventing a second telemetry vocabulary. It preserves provider, causal resource scope, accounting mode, descriptor hash, all token dimensions, run and resource-observation coordinates, environment and repository profiles, and each bounded stage observation.

Provider cached-input tokens become a distinct `tokens` cache entry owned by a digest-stable provider coordinate and bound to the accounting descriptor and repository revision. They are not combined with projection bytes, document counts, entries, calls, or inferred savings. A numeric zero is emitted only when the canonical resource usage explicitly observed zero cached-input tokens.

The work report does not contain grounding, search, verification, acceptance, artifact, publication, or transport-delivery evidence. Those fields remain unavailable or partial with reasons. Terminal run status may be projected independently, but never upgrades the result section to complete. A missing stage-catalog coordinate makes the stage section partial even when every carried stage observation is otherwise complete.

## Installed query

Protocol v10 exposes the projector through `lervo application observability --work <work-id> --json`. The read-only inspection freezes a verified canonical event-chain head, caps the source at 100,000 events, and checks the repository revision before and after projection. An optional `--origin <coordinate>` binds the report to a Discord thread or another surface without moving authority out of canonical execution evidence.

Conflicting stage-catalog versions make the stage section invalid. A missing catalog version remains partial. The installed route does not reinterpret either state as complete and validates the final report against the canonical schema before returning it.
