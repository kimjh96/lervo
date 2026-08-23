# ADR-0037: Hub trace read model distinguishes contiguous and buffered events

Status: `partially superseded`; ADR-0038 defines bounded queries and pagination
Decision date: 2026-08-19

## Context

Hub stores registration, allowlisted events, and contiguous cursor by destination/project. Exposing raw storage could leak all payloads into project lists, present post-gap events as complete timelines, or combine coordinates and state from different snapshots. A separate accumulated read model would become another source requiring synchronization.

## Decision

### One read snapshot

- `HubSyncStore.read` runs a synchronous callback inside one `BEGIN` snapshot transaction and commits afterward. Reject promises and nested read/write transactions.
- Concurrent commits on other connections appear only in later reads.
- `@lervo/hub-trace` depends only on this read port and rebuilds projections from durable sync source; it owns no storage, cursor mutation, index, or authoritative cache.

### Summary-only project list

Project summaries include destination/project/registration IDs, display name, identity/manifest hashes, times, cursor, and counts:

- `storedEventCount`: all durable inbox events
- `continuousEventCount`: verified sequence 1 through cursor
- `bufferedEventCount`: durable events after a gap
- `runCount`: distinct run IDs across both sets

Exclude envelopes, payloads, sessions, and document/verification coordinates. Sort by destination/project IDs.

### Honest run timelines

- Project detail groups runs by first project sequence and gives session, first/last sequence/time, and total/continuous/buffered counts.
- Only run detail returns allowlisted envelopes in project-sequence order, annotated `continuous` when at/below verified cursor or `buffered` when durable beyond a gap.
- Show buffered events but never as complete history. Infer neither run state from missing terminal events nor completion from a buffered terminal event.
- Preserve payload semantics unchanged so selection reasons and verification coordinates remain inspectable.

### Failures and privacy

| Code | Meaning |
| --- | --- |
| `project_not_found`, `run_not_found` | Source absent in the same snapshot; do not invent empty entities. |
| `source_inconsistent` | Index/state mismatch or invalid sync state; return no partial projection. |
| `read_failed` | Snapshot lifecycle failed; claim no successful query. |

Summaries contain no payload. Run detail returns only already-allowlisted events and adds no source or credentials. This package provides no HTTP, authentication/authorization, pagination, cache, or HTML and adds no event.

Fixtures cover project/run/session grouping, gaps moving from buffered to contiguous, duplicate/restart determinism, concurrent registration snapshot isolation, and traversal from context selection to verification.

## Consequences

Trace is a deterministic projection that makes gaps explicit. Authenticated project scoping and UI remain above this layer.
