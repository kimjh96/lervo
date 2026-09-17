# Version evolution and compatibility

Future Lervo product versions may replace UI frameworks, Discord adapters, providers, models, search engines, rerankers, media stores, and execution harnesses while preserving core meanings.

## Evolution contract

- Product-host protocol versions are immutable and explicitly discovered.
- New routes, fields, and capability groups require a new additive protocol or schema version.
- Existing routes and fields keep their meaning; changed semantics require a new named contract.
- Readers support mixed historical event versions before a newer writer activates.
- Never rewrite canonical bytes or historical events to simulate a new version.
- Migrations are content-bound, plan/apply, restart-safe, and report partial or blocked states.
- Projections carry build and source-revision identity and are discarded or rebuilt on mismatch.
- Exact predecessor configuration and data remain available for reviewed rollback when the owning contract promises rollback.
- Deprecation requires observed consumers, a migration path, an announced compatibility window, and a separate reviewed removal decision.

## Validation

Common conformance fixtures run each supported host protocol against current and predecessor release artifacts. Upgrade rehearsal covers clean installation, in-place migration, mixed reader versions, restart during migration, rollback before and after writer activation, stale projection rejection, and replay of historical work and evidence.
