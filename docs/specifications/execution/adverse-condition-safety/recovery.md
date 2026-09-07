# Recovery, effects, and cancellation

## Recovery meaning

Every effect declares its kind, owner, idempotency coordinate, duplicate behavior, automatic-retry boundary, uncertainty, cancellation, compensation, success evidence, absence meaning, recovery owner, privacy-safe failure code, and growing collections.

Recovery compares actual state, durable success evidence, and an external observation when the effect crosses the process boundary:

- `exact_completion`: state is exactly after the effect, durable success evidence is present, and any external effect is independently confirmed applied.
- `exact_rollback`: state is exactly before the effect, success evidence is absent, and any external effect is independently confirmed absent.
- `recovery_required`: every unknown, missing, or contradictory combination.

An external timeout, stream failure, stop failure, lost response, or local cancellation after dispatch is not retryable evidence. Provider start, stream, and stop failures publish `retryable: false`; callers must reconcile before another attempt. Content-addressed local artifact storage remains retryable because duplicate bytes have one identity and conflicting duplicates are rejected.

## Effect inventory

| Effect boundary | Owner | Kind | Idempotency | Automatic retry | Uncertainty and compensation | Durable success evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Managed provider admission | orchestrator managed run | external | run, session, adapter | disabled | reconcile external process | `adapter.started` |
| Event-chain append | event store | local | event ID and content | content-idempotent | journal recovery and exact bytes | validated event envelope |
| CAS artifact append | CAS | local | content hash | content-idempotent | exact content recovery | CAS content hash |
| Managed repository apply | write bridge | repository | exact write plan | before effect only | journal rollback | `run.completed` plus verified state |
| Assignment transition | agent workforce | local | assignment revision | before effect only | restore exact record | assignment event |
| Assignment lease | agent workforce | local | lease generation | before effect only | release authority | lease event |
| Workspace host transition | workspace orchestrator | external | workspace generation | disabled | host reconciliation | workspace event |
| Terminal observation persistence | terminal runtime | local | observation ID | content-idempotent | event recovery | terminal observation event |
| Capability activation | capability runtime | external | activation digest | disabled | provider reconciliation | `capability.activated` |
| Event synchronization | sync worker | external | destination and event ID | disabled | destination reconciliation | `sync.acknowledged` |
| Remote command delivery | command receiver | external | command idempotency key | disabled | receipt reconciliation | execution receipt |
| Organization deployment | deployment runtime | external | deployment attempt | disabled | target reconciliation | deployment receipt |
| Repository migration apply | durable knowledge apply | repository | exact migration plan | before effect only | journal rollback | `knowledge.materialization.applied` |
| Live-trigger assignment invocation | live-trigger reservation store and assignment routine | local | source-event-key and invocation fingerprints | exact replay after recovery only | explicit stale-reservation recovery, then convergent assignment IDs | live-trigger completion plus `assignment.created` |

The machine-readable inventory is versioned in the reliability package and copied into the generated evidence report. Verification fails if a state-changing category lacks an entry.

## Cancellation

Cancellation before an effect produces no effect. During a reversible local or repository transaction, cancellation must roll back or enter recovery. After external dispatch, cancellation requires reconciliation. It does not imply that a provider, tool, workspace host, Hub, or deployment target stopped.

The workforce exposes a pure cancellation plan over the existing assignment DAG. It selects requested assignments and all non-terminal dependents without mutating records. The workforce owner applies transitions under existing revision and event contracts.
