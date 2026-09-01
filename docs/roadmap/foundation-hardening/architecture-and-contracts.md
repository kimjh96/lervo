# Foundation-hardening architecture and contracts

Status: `active`

As of: 2026-09-01

## Purpose

Keep implementation responsibilities narrow while adding causal work, resource, and
performance evidence. The authoritative event details are in
[ADR-0331](../../decisions/operations/trace/0331-adopt-reader-first-causal-work-observability.md).

## Dependency direction

```text
schemas
  -> event-contract and execution-contract
  -> execution-observability projector
  -> execution-performance observation and verification
  -> orchestrator, adapters, terminal runtime, diagnostics, and Hub trace
  -> CLI and future product adapters
```

The diagram describes conceptual dependency flow; package imports must retain the
repository rule that applications do not become dependencies of packages. Storage and
external providers remain effects behind ports.

## Responsibility map

| Boundary                         | Owns                                                             | Must not own                          |
| -------------------------------- | ---------------------------------------------------------------- | ------------------------------------- |
| `@lervo/schemas`                 | v1/v2 envelopes, event payloads, descriptors, report schemas     | aggregation or storage effects        |
| `@lervo/event-contract`          | mixed-version parsing, chain hashing, allowlist privacy          | provider translation                  |
| `@lervo/execution-contract`      | causal, accounting, stage, and failure invariants                | clocks, files, network, provider SDKs |
| `@lervo/execution-observability` | pure work-report projection                                      | event append, pricing, UI formatting  |
| `@lervo/execution-performance`   | paired profiles, statistics, budgets, report verification        | product execution or canonical state  |
| `@lervo/orchestrator`            | work creation, run ancestry, final aggregation, monotonic timing | provider-native semantics             |
| provider adapters                | native usage translation and accounting declaration              | Lervo authority or cross-run totals   |
| terminal runtime                 | availability-safe bounded observations                           | whole-task token claims               |
| event store and CAS              | append, integrity, immutable descriptors                         | report semantics                      |
| sync, Node, and Hub              | capability negotiation and byte-preserving transfer              | local approval authority              |
| diagnostics and Hub trace        | shared projector consumption                                     | duplicate projection logic            |
| CLI                              | command parsing and presentation                                 | storage imports or independent totals |

The new projector package is created only with its first implementation artifact. This
roadmap does not create an empty package placeholder.

## Event-reader capability extension boundary

The compatibility implementation keeps five change reasons separate:

- `@lervo/schemas` declares only the closed versioned report shape;
- the event-schema version catalog owns the compiled readable and writable version
  constants;
- the event-reader capability module owns report creation, semantic validation, and
  typed compatibility failures, independently of event-envelope parsing;
- local diagnostics, Node health, and Hub health only compose that shared report into
  their existing surfaces; and
- sync endpoint mapping is separate from bounded JSON HTTP execution, timeout, response
  parsing, credential transmission, and Hub-identity proof.

Credential transmission uses a named `bearer | none` mode rather than a boolean. A new
authentication mechanism must add an explicit mode and focused transport tests; it
cannot silently reuse the public capability request path. Likewise, future writer
selection and peer-activation policy must be new domain contracts rather than fields or
branches added to the reader advertisement.

Distributed writer activation keeps another four change reasons separate:

- the owner-only repository Node fleet registry owns configured Node membership;
- the installed service definition and owner-only runtime config resolve observation
  coordinates without exposing them in activation evidence;
- Node health and the public identity-bound Hub transport own current capability
  observations; and
- `@lervo/project` owns pure exact-membership, evidence, plan, revalidation, and durable
  writer-coordinate decisions.

The CLI only composes those boundaries. It does not own another inventory, duplicate
health validation, parse native service definitions inside the command entrypoint, or
grant activation from caller-authored remote evidence. Schema version 2 inventory
evidence exposes only repository identity, a source configuration hash, peer identity
hashes, and secret-free capability reports.

The small Hub health, Node health contract, Node health publisher, schema, and trace
modules remain cohesive and are not split by line count alone. A generic
runtime-capability registry is intentionally not
introduced until more than one current capability shares the same aggregation and
lifecycle semantics.

## Canonical and derived state

Canonical state consists of versioned events, local CAS artifacts, repository policy,
workstreams, assignments, verification, and exact repository state. The work report,
latency summaries, graphs, indexes, and dashboards are rebuildable projections.

`workId` is only a causal aggregation coordinate. Workstream remains objective and
continuation authority; assignment remains bounded delegated work; run remains an
attempt. No `task`, `workflow`, `memory`, `budget`, or `truth` database is added.

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

FH1 records causality and `run.requested` in one admission transaction. Deterministic
root and event identities permit exact pre-request crash recovery, while an already
admitted run cannot execute twice. SQLite unique constraints independently enforce one
causal event per run and one root per work. If final resource data cannot be obtained, the
run still receives an explicit unavailable or partial observation rather than omitted
telemetry.

Child runs record their causality before provider start. A child cannot reference a
future or foreign-work parent. Repair and retry are distinct: retry repeats a logical
attempt; repair addresses a previously observed incomplete or inconsistent effect.

## Accounting rules

Provider counters are not assumed comparable. Aggregation keys include work, run,
scope, provider-neutral accounting descriptor, and source coordinate. Cumulative
snapshots contribute only their latest valid value; operation deltas contribute once.
Duplicate observations are idempotent. Regressions, descriptor changes within a
cumulative series, and inconsistent totals lower completeness.

The report separates primary provider, subagent provider, retrieval projection,
verification/publication evaluation, deliberation, and improvement evaluation. It does
not collapse them into one cost figure. Price catalogs, currency, discounts, invoices,
and hard budget stops require a later decision after observations are reliable.

## Timing rules

Durations use a monotonic clock and are non-negative. Wall timestamps remain useful for
correlation but never calculate elapsed time. The catalog is bounded and versioned;
unknown vendor spans stay inside adapter evidence until mapped by a reviewed contract.

Instrumentation overhead is measured separately. Stage observations contain digests and
classified profiles, not repository paths, queries, prompts, or outputs. High-cardinality
IDs needed for local joining follow current retention policy and export redaction.

FH3 keeps stage invariants, runtime adapters, report projection, budget policy, fixture
effects, and rendering in separate modules. The provider-free harness alternates arms,
starts every pair from one snapshot, and performs preparation and cleanup outside the
measured hook interval. Its checked aggregate report is rebuildable evidence, not a new
execution or product-authority store.

## Compatibility and failure meanings

- Unsupported envelope version: read stops before mutation and returns a typed error.
- Invalid event or hash: integrity failure; no partial projection is presented as valid.
- Missing observation: `unavailable` with a typed reason.
- Incomplete native counters: `partial`; never zero-filled.
- Counter contradiction: `invalid`; never silently repaired.
- Projection failure: source events remain canonical and replayable.
- Hook internal failure: availability-safe empty response and no false success event.
- Sync peer without v2-reader capability: writer activation is blocked.
- Capability report missing, invalid, or from an unverified peer: writer activation is
  blocked while current v1 synchronization remains valid.

`EventReaderCapabilitiesV1` advertises only readable envelope versions. It is emitted
by local diagnostics, Node health, and Hub health, and is readable through the sync
transport. It contains no writer selection or activation field, so capability evidence
cannot be mistaken for authority.

Historical v1 events retain their original meaning. Projection may label them
`legacy_unlinked`, but cannot infer a work tree from timestamps, sessions, text, or
model output.

## Extension boundary

Future models, providers, harnesses, retrieval systems, skills, MCP servers, and product
interfaces enter behind versioned adapters and conformance suites. They may add evidence
only through declared mappings and cannot grant authority. This keeps rapid AI technique
changes at replaceable edges while Lervo's work, evidence, recovery, and verification
meanings remain stable.
