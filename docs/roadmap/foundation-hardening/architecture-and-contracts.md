# Foundation-hardening architecture and contracts

Status: `complete`

As of: 2026-09-04

## Purpose

Keep implementation responsibilities narrow while adding causal-work, resource, and performance evidence. [ADR-0331](../../decisions/operations/trace/0331-adopt-reader-first-causal-work-observability.md) defines the authoritative event details.

## Dependency direction

```text
schemas
  -> event-contract and execution-contract
  -> execution-observability projector
  -> execution-performance observation and verification
  -> execution-reliability adverse-condition evidence
  -> orchestrator, adapters, terminal runtime, diagnostics, and Hub trace
  -> CLI and future product adapters
```

This is conceptual dependency flow. Package imports must preserve the repository rule that applications never become package dependencies. Storage and external providers remain effects behind ports.

## Responsibility map

| Boundary | Owns | Must not own |
| --- | --- | --- |
| `@lervo/schemas` | v1/v2 envelopes, event payloads, descriptors, report schemas | aggregation or storage effects |
| `@lervo/event-contract` | mixed-version parsing, chain hashing, allowlist privacy | provider translation |
| `@lervo/execution-contract` | causal, accounting, stage, and failure invariants | clocks, files, network, provider SDKs |
| `@lervo/execution-observability` | pure work-report projection | event append, pricing, UI formatting |
| `@lervo/execution-performance` | paired profiles, statistics, budgets, report verification | product execution or canonical state |
| `@lervo/execution-reliability` | effect inventory, recovery matrix, privacy, threat, capacity, and rehearsal evidence | runtime effects or retry authority |
| foundation readiness scripts | source-bound check composition, clean-clone journeys, aggregate evidence | product execution or canonical state |
| `@lervo/orchestrator` | work creation, run ancestry, final aggregation, monotonic timing | provider-native semantics |
| provider adapters | native usage translation and accounting declaration | Lervo authority or cross-run totals |
| terminal application modules | short dispatch, hook orchestration, lifecycle inspection, bounded observation persistence | whole-task token claims |
| event store and CAS | append, integrity, immutable descriptors | report semantics |
| sync, Node, and Hub | capability negotiation and byte-preserving transfer | local approval authority |
| diagnostics and Hub trace | shared projector consumption | duplicate projection logic |
| CLI | command parsing and presentation | storage imports or independent totals |

Repository automation follows the separate [repository script architecture](../../architecture/repository-scripts.md). The former flat root, `lib`, and `test` collections are grouped by release, distribution, evaluation, foundation, and quality ownership. Shared script contracts have no reverse domain dependency; release composes distribution, and distribution depends only on shared contracts. An automated quality check protects path ownership, package entrypoints, relative imports, test boundaries, and dependency direction.

The runtime-service manager, managed-provider HTTPS pilot, and lexical-v2 provider comparison use thin command adapters and separate implementation modules. Longer implementation modules remain subject to exact-content structural review. One V18 canary root executable remains a digest-verified historical-evidence exception; restructuring did not rewrite its reviewed bytes or the evidence-bound natural-language evaluation namespace.

Create the projector package only with its first implementation artifact; do not create an empty placeholder.

## Event-reader capability extension boundary

Keep these compatibility change reasons separate:

- `@lervo/schemas` declares only the closed versioned report shape.
- The event-schema version catalog owns compiled readable and writable version constants.
- The event-reader capability module owns report creation, semantic validation, and typed compatibility failures independently of event-envelope parsing.
- Local diagnostics, Node health, and Hub health only compose that shared report into existing surfaces.
- Sync endpoint mapping remains separate from bounded JSON HTTP execution, timeout, response parsing, credential transmission, and Hub-identity proof.

Credential transmission uses a named `bearer | none` mode, not a boolean. A new authentication mechanism must add an explicit mode and focused transport tests; it cannot silently reuse the public capability-request path. Future writer selection and peer-activation policy must be new domain contracts, not fields or branches in the reader advertisement.

Distributed writer activation also separates four change reasons:

- The owner-only repository Node fleet registry owns configured Node membership.
- The installed service definition and owner-only runtime config resolve observation coordinates without exposing them in activation evidence.
- Node health and the public identity-bound Hub transport own current capability observations.
- `@lervo/project` owns pure exact-membership, evidence, plan, revalidation, and durable writer-coordinate decisions.

The CLI only composes these boundaries. It must not own another inventory, duplicate health validation, parse native service definitions in the command entrypoint, or grant activation from caller-authored remote evidence. Schema version 2 inventory evidence exposes only repository identity, a source-configuration hash, peer-identity hashes, and secret-free capability reports.

The small Hub health, Node health contract, Node health publisher, schema, and trace modules remain cohesive and are not split by line count alone. Do not introduce a generic runtime-capability registry until multiple current capabilities share the same aggregation and lifecycle semantics.

## Canonical and derived state

Canonical state comprises versioned events, local CAS artifacts, repository policy, workstreams, assignments, verification, and exact repository state. Work reports, latency summaries, graphs, indexes, and dashboards are rebuildable projections.

`workId` is only a causal aggregation coordinate. Workstream retains objective and continuation authority; assignment remains bounded delegated work; run remains an attempt. Do not add a `task`, `workflow`, `memory`, `budget`, or `truth` database.

## Event ordering

A managed root follows this minimum order:

```text
work.causality.recorded
  -> run.requested
  -> adapter and context lifecycle
  -> resource.usage.recorded
  -> execution.stages.observed
  -> run.completed | run.failed
```

FH1 records causality and `run.requested` in one admission transaction. Deterministic root and event identities support exact pre-request crash recovery, while an admitted run cannot execute twice. SQLite unique constraints independently enforce one causal event per run and one root per work. If final resource data is unavailable, the run still receives an explicit unavailable or partial observation; telemetry is never omitted.

Child runs record causality before provider start. A child cannot reference a future parent or a parent from another work. Retry repeats a logical attempt; repair addresses a previously observed incomplete or inconsistent effect.

## Accounting rules

Provider counters are not assumed comparable. Aggregation keys include work, run, scope, provider-neutral accounting descriptor, and source coordinate. Cumulative snapshots contribute only their latest valid value; operation deltas contribute once. Duplicate observations are idempotent. Regressions, descriptor changes within a cumulative series, and inconsistent totals lower completeness.

The report separately represents primary provider, subagent provider, retrieval projection, verification/publication evaluation, deliberation, and improvement evaluation; it does not collapse them into one cost figure. Price catalogs, currency, discounts, invoices, and hard budget stops require a later decision after observations become reliable.

## Timing rules

Durations use a monotonic clock and are non-negative. Wall timestamps support correlation but never calculate elapsed time. The stage catalog is bounded and versioned; unknown vendor spans remain in adapter evidence until mapped by a reviewed contract.

Measure instrumentation overhead separately. Stage observations contain digests and classified profiles, not repository paths, queries, prompts, or outputs. High-cardinality IDs required for local joins follow current retention policy and export redaction.

FH3 separates stage invariants, runtime adapters, report projection, budget policy, fixture effects, and rendering. Its provider-free harness alternates arms, starts each pair from one snapshot, and performs preparation and cleanup outside the measured hook interval. The checked aggregate report is rebuildable evidence, not a new execution or product-authority store.

The terminal command entrypoint only dispatches. Prompt-context preparation, activation state, lifecycle inspection, terminal event coordinates and persistence, declaration, hook orchestration, stage persistence, coverage rendering, and repository-root discovery remain independent modules. Provider-neutral search and workspace contracts remain outside those application adapters.

FH4 separates pure effect semantics in `@lervo/execution-contract`, reviewed inventory and rebuildable evidence in `@lervo/execution-reliability`, runtime fault behavior in owning packages, and check composition in scripts. The reliability projector neither executes recovery nor becomes a scheduler. Workforce capacity and assignment-DAG cancellation are pure policies; persistence retains revision, lease, and event authority.

FH5 separates focused-suite inventory, command execution, clean-clone setup, report construction, report verification, and aggregate-command composition into script modules. It records bounded hashes and durations, but no command output, provider content, repository path, or credential. The aggregate composes constituent evidence and never reimplements domain semantics.

## Compatibility and failure meanings

- Unsupported envelope version: stop reading before mutation and return a typed error.
- Invalid event or hash: treat as an integrity failure; do not present a partial projection as valid.
- Missing observation: report `unavailable` with a typed reason.
- Incomplete native counters: report `partial`; never zero-fill them.
- Counter contradiction: report `invalid`; never silently repair it.
- Projection failure: canonical source events remain replayable.
- Hook internal failure: return an availability-safe empty response and emit no false success event.
- Sync peer without v2-reader capability: block writer activation.
- Missing or invalid capability report, or a report from an unverified peer: block writer activation while preserving valid current v1 synchronization.

`EventReaderCapabilitiesV1` advertises only readable envelope versions. Local diagnostics, Node health, and Hub health emit it, and the sync transport can read it. It contains no writer-selection or activation field, so capability evidence cannot be mistaken for authority.

Historical v1 events retain their original meaning. Projection may label them `legacy_unlinked`, but cannot infer a work tree from timestamps, sessions, text, or model output.

## Extension boundary

Future models, providers, harnesses, retrieval systems, skills, MCP servers, and product interfaces enter through versioned adapters and conformance suites. They may add evidence only through declared mappings and cannot grant authority. Rapid AI technique changes therefore remain at replaceable edges while Lervo's work, evidence, recovery, and verification meanings stay stable.
