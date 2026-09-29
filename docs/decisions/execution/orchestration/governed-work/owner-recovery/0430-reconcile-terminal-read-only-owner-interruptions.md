# ADR-0430: Reconcile terminal read-only owner interruptions without inventing usage

- Status: accepted
- Decision date: 2026-09-24

## Context

ADR-0407 covers started read-only managed turns whose owning unit died before a usage receipt or terminal. Kael's first owner reasoning run instead recorded `resource.usage.recorded` with `status: unavailable` and a `run.failed` terminal with `failureCode: provider_stop_failed`, but no `adapter.stopped`. The Codex turn was interrupted, and a later unit invocation succeeded the incident invocation. Applying ADR-0407 would append a second terminal and contradict history. Counting unavailable usage as zero would understate possible spend; treating the failed receipt as confirmed would invent a stop acknowledgement.

After that repair, Kael's next admitted owner run recorded `provider_start_failed` and provider-reported unavailable/null usage, without `adapter.started`, process observation, or business effect. Source revalidation failed before adapter-start acknowledgement. History cannot prove whether the adapter briefly began external work: a process fence and the full spent-unknown reservation remain required. This failure must not count as a successful turn or erase a reviewed attempt limit.

## Decision

An explicit owner-fenced `reconcile-interrupted-owner` command may settle only an exact admitted `work.owner_reasoning.v1` decision. Its private CAS diagnostic contains `schemaVersion: 1`, one exact kind, every run event's ID/hash/type in an array, and one `host.unit_invocation_witness`. Only two disjoint terminal shapes qualify:

- `work.owner_reasoning_interrupted_stop_failure`: one read-only `adapter.started`; at least one provider process observation with `provesWorkProgress: false`; one provider-reported unavailable/null usage receipt with `resource_observation_missing`; a final nonretryable `provider_stop_failed` terminal; no adapter stop, effect, or work-progress event.
- `work.owner_reasoning_unacknowledged_start_failure`: reservation, causality, request, resolution, one provider-reported unavailable/null usage receipt, one stage observation, and a final nonretryable `provider_start_failed` terminal, in exactly that order. No adapter start, process observation, stop, context delivery, or effect is allowed. The receipt's actor and model provider must match.

The host witness proves that the incident process ended and a successor invocation started. Neither shape estimates tokens or claims provider output was used. Both retain the full reserved spend as unknown and require separate authority for another attempt.

Under the exclusive owner lease and a still-installed, unrevoked, unexpired mandate, the command writes one envelope-v3 `work.supervision.owner_reasoning.interruption_reconciled` event. At commit it rechecks the admitted decision, event head, entire run history, current unit invocation, witness freshness, and installation. The original `run.failed` and unavailable usage receipt remain immutable; a deterministic reconciliation ID rejects duplicate repair.

Required event fields are the common supervision coordinates plus `decisionId`, `planHash`, `managedRunId`, `terminalEventId`, and `diagnosticArtifactHash`. Causes are the decision and terminal IDs. Neither event nor diagnostic contains prompts, provider output, repository bytes, credentials, source paths, or raw error text. Missing, mismatched, stale, over-bound, or unprovable evidence produces no write and leaves inspection `uncertain`.

Compatible readers check the exact decision and proof before treating the failed owner invocation as terminal for supervision. The run remains in canonical execution history. For resource projection only, its unavailable usage and any adapter start leave the observation population; its full token reservation remains spent-unknown. A cumulative mandate may therefore reject a later decision at its aggregate limit. Kael's installed V3 mandate instead uses reviewed `per_attempt_only` accounting: cumulative reservation is not an admission limit, but the two-attempt ceiling still applies. Reconciliation grants no execution, extra attempt, or publication.

## Rollout and acceptance

Install compatible CLI, Hub, and Node readers before appending this event to a shared journal. Install a Node reader that understands the start-failure diagnostic before writing that variant; an older reader may parse the event but cannot promote its proof.

Tests must cover both exact terminal shapes, stale or mismatched witnesses, writable adapters, work progress, observed usage, late run events, changed pins, duplicate repair, owner-fence races, and conservative resource accounting.

Installed acceptance requires each exact Kael run to reconcile once, a fresh owner decision under sufficient reviewed authority, a worker result, verification, independent review, and visible publication. Source tests or healthy service status do not close this gate.

## References

- [ADR-0407](../0407-settle-invocation-fenced-abandoned-turns.md)
- [Supervision event contract](../../../../../specifications/execution/outcome-supervision/contracts/events.md)
