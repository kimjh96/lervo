# Artifact projection and cursor

## Projection

Each new `deliberation.artifact.recorded` repository event passes through `readDeliberationArtifactEvents` in `@lervo/deliberation`. For a bound artifact, the Discord projector requires exactly one active real-participant binding, verifies its writing-gated Markdown byte count and content hash, and asks that participant runtime to publish through its existing deployment. It adds no policy-role heading, round number, role ID, claim count, or gate status.

The reader reports `complete` only when every artifact event carries a schema-valid structured artifact whose project, deliberation, artifact, kind, round, producer role, provider, run, session, content, permit, and timestamp coordinates agree with its envelope and summary. A legacy summary-only event makes structured history `unavailable`; no partial artifact list is returned. Duplicate or contradictory coordinates are `invalid`. The reader never loads Markdown bodies.

An unbound artifact advances the internal cursor without creating a Discord event. Canonical coordinates remain available for activity, trace, search, and future first-party views. Prompts, private reasoning, unverified provider payloads, credentials, and native Discord identifiers remain excluded.

Canonical contributions remain complete when a channel has a smaller presentation limit. Discord deterministically presents an observation-only excerpt within its 2,000-character bound and states that the complete contribution remains available through Lervo records and unified search. Human-directed replies are never silently shortened. Delivery receipts prove the bounded Discord projection; the original artifact hash and conversation outbound retain the complete writing-gated content.

## Cursor and recovery

The rebuildable `deliberation-artifact-cursor.json` stores schema version, exact cursor kind, project ID, integration ID, last inspected repository-event sequence, and update time. Missing state checkpoints the current head to prevent surprise historical replay.

For a bound origin, advancement follows exactly one durable interaction outbound. A crash before advancement is deduplicated by deterministic source-event identity. Platform delivery remains the responsibility of the interaction outbox and adapter receipt. Legacy events without origin are skipped and cannot satisfy product acceptance. Invalid structured evidence, unavailable interaction ownership, or zero or multiple responding policies fails the worker before advancement. Startup validates the required proactive signal subscription.
