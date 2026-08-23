# ADR-0177: Bounded Execution Event Sources

- Status: accepted
- Decision date: 2026-08-23

## Context

An append-only private event store is not automatically safe compiler input. Knowledge events would create apply self-reference, `verification.completed` is weaker than ADR-0176, and rehashed nonallowlisted payloads must remain excluded.

## Decision

`execution-event-v1+event-chain` shares the supplemental-source port. It validates the hash chain through a starting sequence and enforces these limits:

- Maximum sequence: 100,000
- Maximum selected events: 4,096
- Maximum canonical UTF-8 event size: 256 KiB
- Maximum total size: 16 MiB

Overflow returns no partial history.

Every event is schema-validated, hash-recomputed, and re-sanitized by type. Redaction must be zero, and stored payload and canonical bytes must match exactly. The initial allowlist covers run, context, handoff, adapter, capability, tool/command/file change, skill, `verification-started`, deliberation, and unmanaged-change lifecycles. `verification.completed` uses ADR-0176 only. `knowledge.*`, document lifecycle, identity migration, and sync acknowledgement are outside this adapter's coverage.

Each event becomes canonical `@event/<event-id>` with ordinary `execution_event` origin and an exact `event:<id>` full-byte unit. Knowledge commands and managed search collect verification and event supplements once per shared plan/apply boundary. Scanner core never opens event storage.

Full `snapshotId` includes events. `contentSnapshotId` excludes revision, verification, and events. Events prove recorded work or observation only. Selected, loaded, injected, and used remain distinct; completion or exit zero proves neither claim truth nor verified knowledge. Semantic candidates remain unreviewed.

Any chain, schema, hash, privacy, canonical, identity, or bound failure aborts as `knowledge_evidence_source_invalid` without exposing IDs, types, paths, payloads, hashes, tool coordinates, identities, or secrets. An empty allowlist result is a valid empty source. Appends after the snapshot wait.

## Consequences

Fixtures verify exact canonical sources, full/content snapshot separation, nonleaking rejection of rehashed private fields, and simultaneous event-plus-verification collection from real managed-provider storage.
