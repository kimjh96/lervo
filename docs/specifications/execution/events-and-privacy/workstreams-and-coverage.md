# Workstreams and coverage

## Workstream snapshots

`workstream.snapshot.recorded` retains workstream ID, monotonic revision, status, change kind, snapshot and previous hashes, content-addressed snapshot and optional legacy-source artifact IDs, and time. It excludes objective, tasks, blockers, notes, references, source bodies, prompts, credentials, and absolute paths.

The local projection is written lazily under `.lervo/state/workstreams/`; exact snapshots and migrated source bytes are CAS artifacts. Migration or update publishes files before recording the event and rolls them back if the event fails.

## Terminal coverage

`lervo terminal coverage` is rebuildable. Preparation is diagnostic; managed delivery is unavailable without an adapter receipt; explicit reference is nullable when Stop output is unavailable; relevance is nullable without ground truth. No combined score exists.

Terminal coverage keeps resource meanings separate. Whole-task provider usage is always `unavailable` with `unmanaged_provider_usage_unobserved` because direct provider execution is outside the managed adapter boundary. Usage directly retained by the query-projection receipt is reported separately as `partial` with `accounting_descriptor_unavailable`; a missing receipt counter is `query_projection_usage_unavailable`. Neither value is billed cost.

## Managed context evidence

Managed `context.injected` events include adapter and provider session and, for every document, E3 receipt, ID, hash, and scope. `adapter.result.captured` records adapter, provider session, turns, digest, bytes, media type, and reference support without content. `context.referenced` records validated E4 linked to that result and E3 version.

Unknown, stale, altered, cross-turn, or cross-generation tokens create no E4. Contradictory persisted coordinates fail projection. Result and E4 events commit atomically; failure fails the run. Local trace and Hub use one projector; Hub coverage uses complete history despite response pagination.

## Managed resource reporting

Managed resource descriptors contain provider and adapter identity, accounting mode, normalization and native-counter semantic IDs, support state, and nullable model and service tier. Their schemas exclude credentials and unrestricted native metadata.

The shared work report groups observations by provider, scope, source, mode, and descriptor hash; it does not combine cross-provider totals or infer price.
