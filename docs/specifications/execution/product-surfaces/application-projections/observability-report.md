# `SurfaceObservabilityReportV1`

Required top-level fields:

- `schemaVersion: 1` and `kind: product_surface.observability`;
- surface kind and adapter build;
- source event-head hash, repository revision, nullable work and origin coordinates;
- grounding, search, resources, stages, caches, result, and completeness sections; and
- an exact report digest over the ordered projection.

Each section retains its own `complete`, `partial`, `unavailable`, or `invalid` status and typed reason. Section state is never rewritten. Report status is:

- `complete` only if every required section is complete;
- `invalid` if any required section is invalid;
- `unavailable` if no required section has usable evidence;
- otherwise `partial`.

Resource groups retain provider, causal scope, accounting mode, and descriptor hash. Cache entries require cache kind, owner, unit, observed value or explicit unavailable state, source revision, adapter or compiler build, and cold or warm disposition where defined.

Privacy and failure meanings follow [surface observability](../observability.md). The report never converts unavailable observations to zero or combines unlike cache units.

Grounding document counts are independently nullable. Known coverage requires integer numerator and denominator. Unavailable coverage requires null denominator and value plus a reason; a separately observed numerator may remain present. An unavailable denominator or unobserved document stage must not serialize as zero.

## Managed-work projector

`@lervo/product-surface-projection` projects an existing `WorkExecutionReportV1` without re-reading provider output or inventing a second telemetry vocabulary. It preserves provider, causal resource scope, accounting mode, descriptor hash, all token dimensions, run and resource-observation coordinates, environment and repository profiles, and each bounded stage observation.

Provider cached-input tokens become a distinct `tokens` cache entry owned by a digest-stable provider coordinate and bound to the accounting descriptor and repository revision. They are not combined with projection bytes, document counts, entries, calls, or inferred savings. Numeric zero is emitted only when canonical resource usage explicitly observed zero cached-input tokens.

The work report contains no grounding, search, verification, acceptance, artifact, publication, or transport-delivery evidence. Those fields remain unavailable or partial with reasons. Terminal run status may be projected independently but never upgrades the result section to complete. A missing stage-catalog coordinate makes the stage section partial even if every carried stage observation is complete.

## Installed query

Protocol v10 exposes the projector through `lervo application observability --work <work-id> --json`. Read-only inspection freezes a verified canonical event-chain head, caps the source at 100,000 events, and checks repository revision before and after projection. Optional `--origin <coordinate>` binds the report to a Discord thread or another surface without moving authority out of canonical execution evidence.

Conflicting stage-catalog versions make the stage section invalid; a missing catalog version leaves it partial. The installed route does not reinterpret either state as complete and validates the final report against the canonical schema before returning it.
