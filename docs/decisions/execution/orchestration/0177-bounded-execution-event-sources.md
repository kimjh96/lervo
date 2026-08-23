# ADR-0177: Bounded Execution Event Sources

- Status: accepted
- Decision date: 2026-08-23

## Context

An append-only private event store is not automatically safe compiler input. Knowledge events would create apply self-reference; verification.completed is weaker than ADR-0176; rehashed nonallowlisted payloads must remain excluded.

## Decision

execution-event-v1+event-chain shares the supplemental-source port. It validates the hash chain through a starting sequence, caps sequence at 100,000, selected events at 4,096, each canonical UTF-8 event at 256 KiB, and total at 16 MiB. Overflow never returns partial history.

Every event is schema/hash-recomputed and re-sanitized by type; redaction must be zero and stored payload/canonical bytes exact. The initial allowlist covers run, context, handoff, adapter, capability, tool/command/file change, skill, verification-started, deliberation, and unmanaged-change lifecycles. verification.completed uses ADR-0176 only. knowledge.*, document lifecycle, identity migration, and sync acknowledgement are explicitly not this adapter's coverage.

Each event becomes canonical @event/<event-id> with ordinary execution_event origin and exact event:<id> full-byte unit. Knowledge commands and managed search collect verification and event supplements once per shared plan/apply boundary; scanner core never opens event storage.

Full snapshotId includes events; contentSnapshotId excludes revision, verification, and events. Events prove recorded work/observation only. selected, loaded, injected, and used remain distinct; completion or exit zero never yields claim truth or verified knowledge. Semantic candidates remain unreviewed.

Any chain/schema/hash/privacy/canonical/identity/bound failure aborts as knowledge_evidence_source_invalid and exposes no IDs, types, paths, payloads, hashes, tool coordinates, identities, or secrets. Empty allowlist results are valid empty sources; post-snapshot appends wait.

## Consequences

Fixtures verify exact canonical sources, full/content separation, rejection of rehashed private fields without leakage, and simultaneous event plus verification collection from real managed-provider storage.
