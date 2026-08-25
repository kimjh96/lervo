# ADR-0037: Hub Trace Read Model Distinguishes Contiguous and Buffered Events

- Status: `partially superseded`; ADR-0038 defines bounded queries and pagination
- Decision date: 2026-08-19

## Context

The Hub stores registration, allowlisted events, and a contiguous cursor by destination and project. Exposing raw storage could leak payloads into project lists, present post-gap events as complete timelines, or combine coordinates and state from different snapshots. A separate accumulated read model would require synchronization as another source.

## Decision

### One read snapshot

- `HubSyncStore.read` runs a synchronous callback inside one `BEGIN` snapshot transaction and commits afterward. It rejects promises and nested read or write transactions.
- Concurrent commits on other connections appear only in later reads.
- `@lervo/hub-trace` depends only on this read port and rebuilds projections from the durable sync source. It owns no storage, cursor mutation, index, or authoritative cache.

### Summary-only project list

Project summaries include destination, project, and registration IDs; display name; identity and manifest hashes; times; cursor; and these counts:

- `storedEventCount`: all durable inbox events;
- `continuousEventCount`: verified sequences from 1 through the cursor;
- `bufferedEventCount`: durable events after a gap; and
- `runCount`: distinct run IDs across continuous and buffered events.

Summaries exclude envelopes, payloads, sessions, and document or verification coordinates. Sort them by destination and project IDs.

### Honest run timelines

- Project detail groups runs by first project sequence and includes session, first and last sequence and time, and total, continuous, and buffered counts.
- Only run detail returns allowlisted envelopes, ordered by project sequence and annotated `continuous` when at or below the verified cursor or `buffered` when durable beyond a gap.
- Show buffered events, but never as complete history. Infer neither run state from a missing terminal event nor completion from a buffered terminal event.
- Preserve payload semantics unchanged so selection reasons and verification coordinates remain inspectable.

### Failures and privacy

| Code | Meaning |
| --- | --- |
| `project_not_found`, `run_not_found` | Source is absent in the same snapshot; do not invent an empty entity. |
| `source_inconsistent` | Index or state mismatch, or invalid sync state; return no partial projection. |
| `read_failed` | Snapshot lifecycle failed; claim no successful query. |

Summaries contain no payload. Run detail returns only already-allowlisted events and adds no source or credentials. This package provides no HTTP, authentication, authorization, pagination, cache, or HTML and adds no event.

Fixtures cover project, run, and session grouping; gaps moving from buffered to contiguous; duplicate and restart determinism; concurrent registration snapshot isolation; and traversal from context selection to verification.

## Consequences

Trace is a deterministic projection that makes gaps explicit. Authenticated project scoping and UI remain above this layer.
