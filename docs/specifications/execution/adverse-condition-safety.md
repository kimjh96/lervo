# Adverse-condition safety

Status: `active`

As of: 2026-09-01

## Scope

This specification defines FH4 safety evidence for Lervo's current state-changing
boundaries. It does not add a scheduler, loop, execution graph, task authority, or
automatic retry. Canonical repository state, events, CAS artifacts, workstreams,
assignments, runs, approvals, and verification retain their existing ownership.

`@lervo/execution-contract` owns the pure effect and recovery meanings.
`@lervo/execution-reliability` owns the reviewed inventory and rebuildable adverse-
condition report. Runtime packages continue to own their effects and focused fault
tests. The CLI and scripts only compose checks and render results.

## Recovery meaning

Every effect declares its kind, owner, idempotency coordinate, duplicate behavior,
automatic-retry boundary, uncertainty, cancellation, compensation, success evidence,
absence meaning, recovery owner, privacy-safe failure code, and growing collections.

Recovery compares actual state, durable success evidence, and an external observation
when the effect crosses the process boundary:

- `exact_completion`: state is exactly after the effect, durable success evidence is
  present, and any external effect is independently confirmed applied;
- `exact_rollback`: state is exactly before the effect, success evidence is absent, and
  any external effect is independently confirmed absent; and
- `recovery_required`: every unknown, missing, or contradictory combination.

An external timeout, stream failure, stop failure, lost response, or local cancellation
after dispatch is not retryable evidence. Provider start, stream, and stop failures now
publish `retryable: false`; a caller must reconcile before starting another attempt.
Content-addressed local artifact storage remains retryable because duplicate bytes have
one identity and a conflicting duplicate is rejected.

## Effect inventory

| Effect boundary                  | Owner                    | Kind       | Idempotency              | Automatic retry    | Uncertainty and compensation     | Durable success evidence            |
| -------------------------------- | ------------------------ | ---------- | ------------------------ | ------------------ | -------------------------------- | ----------------------------------- |
| Managed provider admission       | orchestrator managed run | external   | run, session, adapter    | disabled           | reconcile external process       | `adapter.started`                   |
| Event-chain append               | event store              | local      | event ID and content     | content-idempotent | journal recovery and exact bytes | validated event envelope            |
| CAS artifact append              | CAS                      | local      | content hash             | content-idempotent | exact content recovery           | CAS content hash                    |
| Managed repository apply         | write bridge             | repository | exact write plan         | before effect only | journal rollback                 | `run.completed` plus verified state |
| Assignment transition            | agent workforce          | local      | assignment revision      | before effect only | restore exact record             | assignment event                    |
| Assignment lease                 | agent workforce          | local      | lease generation         | before effect only | release authority                | lease event                         |
| Workspace host transition        | workspace orchestrator   | external   | workspace generation     | disabled           | host reconciliation              | workspace event                     |
| Terminal observation persistence | terminal runtime         | local      | observation ID           | content-idempotent | event recovery                   | terminal observation event          |
| Capability activation            | capability runtime       | external   | activation digest        | disabled           | provider reconciliation          | `capability.activated`              |
| Event synchronization            | sync worker              | external   | destination and event ID | disabled           | destination reconciliation       | `sync.acknowledged`                 |
| Remote command delivery          | command receiver         | external   | command idempotency key  | disabled           | receipt reconciliation           | execution receipt                   |
| Organization deployment          | deployment runtime       | external   | deployment attempt       | disabled           | target reconciliation            | deployment receipt                  |
| Repository migration apply       | durable knowledge apply  | repository | exact migration plan     | before effect only | journal rollback                 | `knowledge.materialization.applied` |

The machine-readable inventory is versioned in the reliability package and copied into
the generated evidence report. Adding a state-changing category without an inventory
entry fails verification.

## Cancellation, concurrency, and backpressure

Cancellation before an effect produces no effect. Cancellation during a reversible
local or repository transaction must roll back or enter recovery. Cancellation after an
external dispatch requires reconciliation. Cancellation does not imply that a provider,
tool, workspace host, Hub, or deployment target stopped.

The workforce exposes a pure cancellation plan over the existing assignment DAG. It
selects the requested assignments and all non-terminal dependents without mutating
records. Applying those transitions remains the workforce owner's responsibility and
requires the existing revision and event contracts.

Current bounded admission is explicit:

- 256 agents and concurrent leases;
- 10,000 assignments;
- delegation depth eight;
- 64 assignment dependencies or cancellation roots; and
- 32 sources in one workspace integration batch.

Integration order is dependency-ready, then priority, sealed time, and workspace ID.
One finite snapshot includes every ready candidate exactly once. Lervo has no unattended
general scheduler in FH4, so cross-snapshot priority aging and autonomous starvation
claims are unsupported rather than inferred. Capacity rejection occurs before mutation;
lease expiry advances generation but never proves an earlier external process stopped.

## Telemetry privacy registry

The registry covers every top-level payload field in the closed event allowlist. Each
entry declares purpose, privacy class, canonical-event retention, schema-bounded
cardinality, and export only to local or authorized project nodes. Nested values remain
inside their closed parent schema. Prompt, transcript, credential, secret, raw body,
request text, context text, and provider output field names fail the audit.

Opaque IDs and hashes are join coordinates, not prose. Repository coordinates must be
relative. Counts and durations are aggregate or bounded measurements. Event schemas,
allowlists, and redaction remain authoritative; the registry is an audited projection
and grants no new collection or export authority.

## Threat model and extension boundary

The integrated model treats repository content, natural-language requests, patches,
provider output, skills, capability packages, MCP servers, tool results, remote
commands, external systems, and host state as independently untrusted. It covers:

- authority injection, path or symlink escape, secret leakage, dependency and tool-
  schema substitution;
- event or receipt forgery, replay, and cross-repository or cross-tenant confusion;
- hook latency, graph fan-out, and cost amplification;
- poisoned improvement candidates and presentation shown as verified truth; and
- ambiguous external effects and untrusted third-party execution.

Reviewed in-process built-ins do not authorize arbitrary dynamic loading. Third-party
execution remains `disabled_pending_isolation` until an out-of-process protocol supplies
exact identity, revocation, filesystem and network controls, CPU, memory and output
quotas, runtime-only credentials, quarantine, local fallback, and a passing conformance
suite. FH4 passes this gate by preserving the disablement, not by claiming isolation is
implemented.

## Capacity and retention

The evidence names small, medium, large, and concurrent profiles. The current contract
observes windows up to 100,000 events, 10,000 assignments, and 32 concurrent workers.
These provider-free profiles verify deterministic bounded fan-out and join mechanics;
they do not claim provider, network, disk-full, or service throughput.

Every growing collection is one of:

- canonical project-lifetime history with an explicit bounded operation window;
- a hard count bound that rejects before mutation;
- current-state replacement;
- acknowledged outbox purge with bounded claims and backpressure;
- a single recoverable journal; or
- typed age, count, and byte pruning for derived state.

Events and referenced CAS artifacts are intentionally retained for the project lifetime.
They are not silently compacted because they are canonical evidence. A read beyond the
100,000-event operation window, disk exhaustion, or missing durable bytes is an explicit
unsupported or recovery-required state, not permission to delete history. Derived
knowledge and terminal projections rebuild through their normal producers.

## Upgrade, rollback, migration, and drift

The evidence binds current tests for reader activation, failed activation, writer
rollback, repository upgrade and failed upgrade, knowledge migration idempotence, state-
prune recovery, and retrieval drift gates. Old events retain their historical meaning.
A stronger provider or retrieval result cannot offset an authority, recovery, privacy,
or compatibility failure.

## Verification

```bash
pnpm foundation:recovery:check
pnpm foundation:security:check
pnpm foundation:capacity:check
```

The generated report binds the exact source-byte revision, protocol digest, effect and
collection inventories, recovery matrix, telemetry registry digest, threat controls,
capacity environments, and hashes of focused runtime suites. Generated JSON, prompts,
outputs, credentials, and absolute paths are excluded from the evidence identity.

See [foundation adverse-condition evidence](../../evidence/foundation/adverse-condition-v1.md).
