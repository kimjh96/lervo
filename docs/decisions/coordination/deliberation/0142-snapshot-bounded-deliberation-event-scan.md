# ADR-0142: Snapshot-Bounded Deliberation Event Scans

- Status: accepted
- Decision date: 2026-08-22

## Context

Diagnostics returned at most 1,000 events but first collected the entire project history, making memory unbounded and snapshot timing implicit.

## Decision

The integrity check's eventCount is the snapshot's final sequence; later append-only events are excluded. Readers make two passes in pages of at most 1,000.

Pass one finds related run IDs from target start/artifact/completion events and checkpoint-referenced events. Missing checkpoint references inside the snapshot yield deliberation_history_invalid. Pass two retains only events from those runs. More than 1,000 target events or final trace events yields deliberation_trace_too_large without partial output. A cursor that fails to advance to the snapshot end is invalid.

The scan changes no event, checkpoint, lease, or derived index; copies no body, provider output, or prompt; and preserves report v1.

## Consequences

Memory is bounded by target coordinates and 1,000 result events even as project history grows. SQLite still scans twice in linear time. Future rebuildable indexes must preserve the same snapshot, bounds, and source revalidation.
