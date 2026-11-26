# ADR-0636: Answer a served prompt before recording it

Status: `accepted`
Decision date: 2026-11-26
Amends: [ADR-0531](0531-bound-terminal-hooks-and-retain-degraded-context.md)
Related: [ADR-0562](../../../foundation/0562-one-relation-web-one-context-assembler-and-a-stop-ledger.md), [ADR-0635](0635-never-block-a-prompt-over-hook-input-lervo-cannot-read.md)

## Context

ADR-0562 section 4 has the resident host answer a prompt and record its events afterwards, and its consequences ask that the delivery-ordering guarantees be restated for that case. Until now the prompt hook delivered only a context whose records had all been committed:

1. It prepared the context.
2. It recorded the prepared context, the activation receipt, the owner-turn capture request, and the stage observation.
3. It printed the context.

A failure in step 2 replaced the prepared context with the degraded base context. The code comment cites this as "delivery is recorded last".

The resident context socket (slice 1) runs the same hook inside the context server, so a served prompt still waits for step 2. On 2026-11-26, on a copy of this repository, step 2's `event_commit` stage took 40 ms at the median and 75 ms at p90 of 32 served prompts. Other records also follow it before the answer: the stop-appearance record, the governance and learned-notice cursors, and the settlement launch. ADR-0562's target is a prompt hook p95 under 200 ms.

The ordering protected one claim: a delivered context is a recorded context. The repository's invariant is narrower: Lervo claims only what telemetry proves. A context delivered without its record is not a false claim. It is a delivery Lervo does not claim.

## Decision

A served prompt is answered once its context is prepared, and the context server records it afterwards.

- **Answer first.** The hook's I/O gains an optional `answer`, which only the context server provides. The prompt path calls it with the complete answer right after preparation, before any record. The server sends that answer to the client at once, then lets the hook finish its records.
- **The records still follow, in the same order.** The prepared context, the activation receipt, the capture request, the stage observation, the stop appearance, the cursors, and the settlement launch run as before. The stage observation's `total` includes them.
- **A failure after the answer loses only records.** If recording fails, the failed stage observation is recorded with its reason as before, but no degraded context follows: the delivered context stays delivered. Nothing claims that delivery. In particular, no `terminal.context.prepared` or `context.selected` record names it, so a later Stop finds no prepared turn and records nothing for it.
- **A non-worker Stop answers first too, once its repository is captured.** Only an attached worker's Stop can answer with a block, after its lifecycle inspection; any other Stop always answers `{}`. A served non-worker Stop answers `{}` as soon as lifecycle inspection has captured the repository snapshot, then finishes the inspection and its records. The provider may start the next turn then, so the turn's changed paths and its repository change come from that captured snapshot, never from a later read that could include the next turn's edits.
- **The server stays busy until the records finish.** The next request waits as for any running hook: it is declined as `busy` and runs in its own process. A Stop of the same turn comes only after the model's reply, far later than the records take, so it finds the prepared turn.
- **Launches after the answer reach the session through a relay.** A client that sends `relay: true` hands its connection, when an answer is marked `pending`, to a small detached relay process before it exits. The server sends the launches the records asked for, such as the settlement worker or a Stop's knowledge worker and prefetch, on a second line once the records finish. The client closes its own copy of the connection once the relay holds it, and passes on any bytes of the second line it already read, so the relay receives the whole line however early it arrives. The relay starts them with the session's Node and environment, as an in-process hook would, then exits; it gives up after 30 seconds. For an older client, those launches start in the server process with the session's values applied. A launch asked for after the hook finished still fails, as before.
- **A hook in its own process is unchanged.** It has no `answer`, prints only when every record is done, and keeps ADR-0531's degraded fallback.

## Consequences

- A served prompt's response no longer includes its records.
- A context can be delivered without being recorded, when recording fails or the server exits mid-record. Such a turn has no turn evidence, exactly as a turn whose prompt failed to record had before; the difference is that the owner received full context instead of the degraded base.
- For an older client, launches after an answer run under the service's process tree, as they did before slice 3's hand-off. A relaying client keeps them in the session.
- Nothing enforces that a Stop arrives after the records. A Stop, or a quickly queued next prompt, that arrives while the server still records is declined as `busy` and runs in its own process. If the records have not committed by then, that Stop finds no prepared turn and records nothing, and a next prompt can show a governance or learned-notice line again whose cursor is not yet written. A model reply takes far longer than the records do, so this needs a stalled store.

## Verification

- `apps/cli/test/terminal-context-serve-early.test.ts`:
  - a served prompt is answered while its records still wait;
  - the server's drain waits for the records;
  - a launch the records ask for starts in the server and is not handed to the gone client.
- `apps/cli/test/terminal-hook-failure-reasons.test.ts`: with `answer`, the prepared context is delivered once, and a recording failure afterwards prints no degraded context.
