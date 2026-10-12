# ADR-0507: Verify event history at the point of use

Status: `accepted`
Decision date: 2026-10-12

## Context

The SQLite event store re-verified the complete history every time it opened, including read-only opens. Each report transaction did the same, and the context-quality publication path did it once per batch. A complete verification runs SQLite `quick_check` and `foreign_key_check`, decodes every outbox row, and recomputes every event hash and link. Consumers that read history added their own complete check before and after each traversal.

That cost grows with history. A copy of this repository's store holds 20,669 events with 859-byte payloads on average. Opening it takes about 505 ms, of which verification is about 504 ms; the rest of opening takes 1–4 ms. Every terminal hook pays that cost. Synthetic small-payload stores show the same growth: at 10,000 events, opening takes 68 ms and each report write 25 ms; at 30,000 events, 189 ms and 65 ms. Earlier work avoided reopening by reusing handles and keeping in-memory cursors with a 900-second full read. Those changes managed the symptom, not the cause.

The event schema already makes history append-only: the store assigns sequences inside serialized write transactions, and triggers reject updates and deletes. Event hashes are unkeyed, so they detect accidental damage and naive edits but not a deliberate rewrite of the whole chain.

## Decision

The store verifies the rows it returns and the predecessor of each append. Complete-history verification happens only when explicitly requested.

- **Reading.** Every returned event passes the row decoder, which checks the readable schema and recomputes the stored hash. Adjacent sequences in one `list` result must link. Project snapshot traversal (`visitEventSnapshot`, `collectProjectEventsBounded`) requires sequences from 1 without gaps and checks every predecessor link. A traversal may pin the observed head hash and must end exactly at it.
- **Appending.** Before inserting, the store decodes the tail through the same hash check. It also confirms that the tail links to the event before it. A new event therefore extends only a locally consistent chain.
- **Opening and writing.** Opening checks only that the file is this project's store, in the expected format and report layout. Every write transaction repeats this binding check before it does any work.
- **Explicit verification.** `verifyIntegrity()` keeps the complete check: SQLite structure, foreign keys, the report layout, every outbox row and the whole chain from the first event. Diagnostics, inspection, migration and administrative commands keep calling it. Hot paths no longer call it before or after reading.

Consumers that receive events from outside the local store contract keep their own checks. These include Hub synchronization batches, remote projections and diagnostic trace reports.

## Consequences

A modified or corrupted row is rejected whenever it is read, linked or extended, as before. What changes is that damage to rows nobody uses is no longer found at the next open. It is found by the next explicit verification or the next read of that row. Such rows cannot affect any result until they are read. SQLite still reports structural corruption when it reads a damaged page.

Store opening and per-write verification no longer grow with history. On the same repository copy, opening falls from about 505 ms to 1.0–1.7 ms, for both writable and read-only stores. In the synthetic stores, per-write CPU stays at 1.1–1.4 ms from 1,000 to 30,000 events; at 10,000 and 30,000 events it was 21 and 62 ms.

Explicit verification costs the same as before. On the repository copy, alternating runs measured 573–990 ms for the previous algorithm and 597–626 ms for the new one. Reading every event now includes hash checks, so `list` over the full history rises from 117–178 ms to 306–346 ms. A complete traversal therefore costs more per row read, but it verifies the chain once instead of reading history three times. The earlier test that a tampered store fails to open is replaced by tests for each point of use: reading, extending a damaged tail, a valid row with a broken predecessor link, outbox reads and explicit verification.
