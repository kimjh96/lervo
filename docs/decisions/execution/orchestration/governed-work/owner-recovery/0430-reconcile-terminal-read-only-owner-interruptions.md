# ADR-0430: Reconcile terminal read-only owner interruptions without inventing usage

- Status: accepted
- Decision date: 2026-09-24

## Context

ADR-0407 covers a started read-only managed turn whose owning unit died before a usage receipt or terminal. Kael's owner reasoning run instead has a canonical `resource.usage.recorded` with `status: unavailable` and a `run.failed` terminal with `failureCode: provider_stop_failed`, but no `adapter.stopped`. The Codex turn was interrupted, and a later unit invocation succeeded the incident invocation. Reusing ADR-0407 would append a second terminal and contradict the run history. Treating the unavailable usage as zero would understate possible spend; treating the failed receipt as confirmed would claim a stop acknowledgement that never existed.

## Decision

An explicit owner-fenced `reconcile-interrupted-owner` command may settle only an exact admitted `work.owner_reasoning.v1` decision. It requires one read-only `adapter.started`, at least one provider process observation with `provesWorkProgress: false`, one provider-reported unavailable usage receipt with null usage and `resource_observation_missing`, a final nonretryable `provider_stop_failed` terminal, no adapter stop, and no effect or work-progress event. Every run event is pinned by ID, hash and type in a bounded private CAS diagnostic. A `host.unit_invocation_witness` proves the incident process ended and a successor invocation started. The proof is not a token-count estimate or a claim that provider output was used.

The command writes one envelope-v3 `work.supervision.owner_reasoning.interruption_reconciled` event under the exclusive owner lease and a still-installed, unrevoked, unexpired mandate. It rechecks the admitted decision, event head, entire run history, current unit invocation, witness freshness and installation at commit. The original `run.failed` and unavailable usage receipt remain immutable. The deterministic reconciliation ID rejects duplicate repair. The event's required fields are the common supervision coordinates plus `decisionId`, `planHash`, `managedRunId`, `terminalEventId`, and `diagnosticArtifactHash`; its causes are the decision and terminal IDs. The event and diagnostic contain no prompt, provider output, repository bytes, credentials, source paths or raw error text. Missing, mismatched, stale, over-bound or unprovable evidence means no write and continued `uncertain` inspection.

Compatible readers check the exact decision and proof before considering the failed owner invocation terminal for supervision. The run remains in canonical execution history. For resource projection only, its unavailable usage and adapter start leave the observation population; its full token reservation remains in the spent-unknown population. Thus a later decision can pass observation completeness but still fails the mandate's aggregate limit if the conservative reservation exhausts it. Repeating owner reasoning requires independently reviewed budget or a new authorized goal; reconciliation itself grants neither execution nor publication.

## Rollout and acceptance

CLI, Hub and Node readers that recognize this event must be installed before the command can append it to a shared journal. Tests must cover the exact terminal shape, stale or mismatched witness, writable adapter, work progress, observed usage, late run events, changed pins, duplicate repair, owner-fence race, and conservative resource accounting. Installed acceptance additionally requires the exact Kael run to reconcile once, a fresh owner decision under sufficient reviewed authority, a worker result, verification, independent review and visible publication. Source tests or healthy service status do not close that installed gate.

## References

- [ADR-0407](../0407-settle-invocation-fenced-abandoned-turns.md)
- [Supervision event contract](../../../../../specifications/execution/outcome-supervision/contracts/events.md)
