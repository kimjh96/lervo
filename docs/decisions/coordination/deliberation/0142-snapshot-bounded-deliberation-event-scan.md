# ADR-0142: Snapshot-Bounded Deliberation Event Scans

- Status: accepted
- Decision date: 2026-08-22

## Context

Diagnostics returned no more than 1,000 events but first collected the entire project history, leaving memory unbounded and snapshot timing implicit.

## Decision

The integrity check's `eventCount` is the snapshot's final sequence. Later append-only events are excluded. Readers scan twice in pages of at most 1,000 events.

The first pass finds related run IDs from the target start, artifact, and completion events and from checkpoint-referenced events. A missing checkpoint reference within the snapshot produces `deliberation_history_invalid`.

The second pass retains only events from those runs. More than 1,000 target events or final trace events produces `deliberation_trace_too_large`, without partial output. A cursor that does not advance to the snapshot end is invalid.

The scan changes no event, checkpoint, lease, or derived index. It copies no body, provider output, or prompt, and preserves report v1.

## Consequences

Memory remains bounded by target coordinates and 1,000 result events as project history grows. SQLite still scans twice in linear time. Future rebuildable indexes must preserve the same snapshot, bounds, and source revalidation.
