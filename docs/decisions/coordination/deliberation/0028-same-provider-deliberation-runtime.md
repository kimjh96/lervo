# ADR-0028: Same-provider role isolation and deliberation evidence binding

Status: `accepted`
Decision date: 2026-08-19

## Context

Receipt IDs in deliberation artifacts did not prove they came from real preparation/injection. `document.loaded` lacked its E2 evidence ID and `context.injected` exposed only the aggregate adapter receipt, preventing direct E3 comparison. With proposer and reviewer on one provider, provider name alone cannot prove independent roles; run/session/provider-session and source receipts must all differ and match source events.

## Decision

### Bind receipts to source events

- Add `evidenceReceiptId` to `document.loaded` for per-document E2.
- Add `evidenceReceiptIds` to `context.injected` for every per-document E3 in the envelope. Keep existing `receiptId` as aggregate adapter receipt.
- `ManagedProviderRunResult` returns a read-only snapshot of actual preparation/injection `ContextEvidence`.
- `@lervo/deliberation-runtime` compares this snapshot to the same run's SQLite events across project/run/session, document ID/hash/bytes/revision, envelope, target turn, generation, adapter receipt, and evidence IDs.
- Require matching `run.completed` result-artifact coordinates before using provider output as deliberation input.

### Separate execution from deliberation

`DeliberationRuntime` knows no adapter. It consumes caller-executed `ManagedProviderRunCoordinator` results and:

1. Validates policy and records `deliberation.started`.
2. Verifies each role's managed result against source events.
3. Runs writing evaluation and revalidates permit and CAS source.
4. Records only artifacts passing current history contract.
5. Atomically records bound shared-context publication and handoff.
6. Revalidates the proposed outcome against complete history, then records `deliberation.completed`.

Core runtime does not materialize source into managed document paths. A generated-document publisher owns paths and sidecars. The fixture writes permitted source to isolated `.lervo/generated` and makes the next role's real loader reread the same hash.

### Role isolation even on one provider

Every role needs distinct Lervo run, Lervo session, provider session, and E2/E3 receipts. Reusing a provider session across roles fails as `context_evidence_invalid/provider_session_reused`; history validation also rejects reused run/session/receipt coordinates.

### Events, privacy, and failures

The two new event fields contain opaque IDs only. They add no document bodies, prompts, responses, tool inputs, credentials, or reasoning.

- `runtime_state_invalid`: invalid lifecycle or runtime coordinates
- `context_evidence_invalid`: managed result, receipt, shared context, or provider-session evidence differs from events
- `artifact_publication_failed`: invalid writing publication, history, publication, or handoff
- `event_recording_failed`: redaction or event transaction failed

If artifact validation fails after a provider run, retain `run.completed` as execution fact but emit no deliberation-artifact event. A caller may record an explicit failed outcome only while event storage remains healthy; telemetry failure can never become success.

Filesystem CAS/SQLite fixtures run independent proposer/reviewer sessions on the same Codex provider, reinject the published proposal for review, finish `no_consensus` on a blocking objection, reject forged receipt IDs, and prove source is absent from events.

## Consequences

Provider identity is not role-isolation evidence. Deliberation artifacts require source events, actual context, provider-session isolation, writing permits, and valid history together. ADR-0029 applies the same ports across Codex and Claude.
