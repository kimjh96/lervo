# Version evolution and compatibility

Future Lervo versions may replace UI frameworks, Discord adapters, providers, models, search engines, rerankers, media stores, and execution harnesses while preserving core meanings.

## Evolution contract

- Application contract and schema versions are immutable.
- New routes, fields, and capability groups require a new additive contract or schema version.
- Existing routes and fields retain their meaning; changed semantics require a new named contract.
- Readers must support mixed historical event versions before a newer writer activates.
- Never rewrite canonical bytes or historical events to simulate a new version.
- Migrations must be content-bound, use plan/apply, be restart-safe, and report partial or blocked states.
- Projections must carry build and source-revision identity and be discarded or rebuilt on mismatch.
- Exact predecessor configuration and data must remain available for reviewed rollback when the owning contract promises rollback.
- Deprecation requires observed consumers, a migration path, an announced compatibility window, and a separate reviewed removal decision.

## Validation

Common conformance fixtures must run each supported application contract against current and predecessor release artifacts.

Upgrade rehearsal must cover:

- Clean installation and in-place migration.
- Mixed reader versions.
- Restart during migration.
- Rollback before and after writer activation.
- Stale projection rejection.
- Replay of historical work and evidence.
