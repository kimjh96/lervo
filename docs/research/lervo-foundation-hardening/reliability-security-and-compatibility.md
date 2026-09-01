# Lervo foundation reliability, security, and compatibility

Status: `accepted input`

As of: 2026-09-01

## Purpose

Identify cross-cutting foundations whose late correction would rewrite durable history,
break products and adapters, or make unattended execution unsafe. Existing protections
are inputs; this document does not imply that all proposed system-level proofs exist.

## Foundation matrix

| Foundation           | Existing basis                                                                                                | Gap to close before broad expansion                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical authority  | Repository sources, event chain, CAS, policies, and exact plans are authoritative; graphs and indexes rebuild | Publish one ownership map for every new public entity and prohibit parallel task, workflow, memory, and truth authorities                                         |
| Causal identity      | Workstream, assignment, run, session, provider turn, agent, and event IDs exist                               | Define one end-to-end work envelope, parent-child causality, attempt identity, retry identity, and orphan reconciliation                                          |
| Public contracts     | Schemas, ports, common adapter tests, CLI behavior, and additive terminal evolution exist                     | Version the headless command/query/event/subscription boundary and publish reader, writer, deprecation, capability-negotiation, and unknown-field rules           |
| Durable effects      | Content-bound plan/apply, journals, CAS, rollback, and recovery exist in important paths                      | Build one failure-injection matrix across every durable transition, including crash-before/after-effect, event failure, restart, and cleanup                      |
| External uncertainty | Remote effects and lease expiry avoid inferred success                                                        | Standardize idempotency, retryability, cancellation, compensation, and reconciliation for providers, tools, MCP, messages, deployments, and Hub commands          |
| Concurrency          | Leases, generations, path conflicts, scheduler locks, CAS finalization, and isolated workspaces exist         | Define queue fairness, backpressure, cancellation propagation, starvation, priority, capacity rejection, clock assumptions, and duplicate worker behavior         |
| Privacy              | Event allowlists, redaction, digests, bounded errors, and runtime-only secrets exist                          | Create a telemetry field registry with purpose, retention, cardinality, export class, deletion meaning, and local-versus-Hub policy                               |
| Extension security   | Exact hashes, dependency locks, permissions, activation receipts, and provider adapters exist                 | Add an integrated threat model, out-of-process third-party protocol, resource quotas, network/filesystem isolation, revocation, quarantine, and conformance suite |
| Compatibility        | Schema versions, migrations, historical additive reads, release intent, and rollback practices exist          | Publish supported N/N-1 behavior or another explicit policy, golden historical fixtures, downgrade limits, migration idempotence, and rollback rehearsal          |
| Capacity             | Many scanners, collections, outputs, and retention classes are bounded                                        | Define supported repository profiles and load tests for documents, bytes, events, CAS, agents, assignments, graph edges, subscriptions, and concurrent runs       |
| Evaluation           | Search and provider experiments use frozen cases, paired gates, failure preservation, and rollback            | Establish platform-wide golden journeys, drift detection, adversarial cases, canaries, and post-activation outcome review                                         |
| Operability          | Status, doctor, trace, coverage, readiness, recovery, and release checks exist                                | Provide one bounded support bundle, health taxonomy, backup/restore drill, degraded-mode policy, and operator runbook for each stateful service                   |

## Failure semantics that must be uniform

Every public operation should declare:

- whether it is read-only, local effect, repository effect, or external effect;
- its idempotency coordinate and duplicate behavior;
- the point before which a retry is safe and after which reconciliation is required;
- cancellation behavior before start, during provider work, during local apply, after an
  external request, and during verification;
- its durable success event and what absence means;
- whether compensation restores bytes, authority, external state, or only observability;
- its recovery owner and operator action; and
- privacy-safe failure codes distinct from unrestricted diagnostic artifacts.

Timeout is not a single meaning. It may mean “known not started,” “local process stopped,”
“provider still running,” “remote effect uncertain,” or “result arrived but persistence
failed.” Loops and graphs must branch on these typed states, not on a generic exception.

## Crash and recovery proof

Before unattended continuation, exercise each state-changing path at every boundary:

```text
validate -> reserve/lease -> stage -> external or repository effect
         -> verify -> event commit -> publish projection -> cleanup
```

For each injected interruption, restart must deterministically produce one of three
outcomes: exact completion, exact rollback, or `recovery_required` with no automatic
retry. Repeat recovery must be idempotent. A durable event and actual bytes or external
observation must never disagree silently.

The proof set should include disk full, process kill, truncated state, SQLite busy or
corruption handling, missing CAS data, wall-clock movement, network partition, duplicate
delivery, stale lease, provider continuation after local cancellation, and failure while
recording the failure itself. Destructive recovery should be tested on generated
fixtures, not inferred from happy-path tests.

## Concurrency and capacity

Path leases solve write overlap but do not by themselves define a platform scheduler.
Before goals, routines, mentions, or graph fan-out create more work, define:

- admission limits by repository, provider, agent, execution target, and external service;
- bounded queues, rejection codes, priority and fairness, and starvation prevention;
- propagation of deadline, cancellation, and budget through subagent ancestry;
- behavior when a lease expires while the provider continues working;
- join semantics when one parallel branch fails or becomes uncertain;
- maximum graph nodes, edges, depth, fan-out, retries, event rate, and retained artifacts;
- load-shedding that preserves repository integrity and local operation; and
- deterministic reconstruction after events or projections exceed one process window.

Supported profiles should cover at least small, medium, and large repositories plus a
concurrent workforce profile. Bounds should be reported as product contracts or explicit
unsupported states, not hidden implementation constants.

## Integrated threat model

The threat model should treat all of the following as independently untrusted: repository
content, natural-language requests, generated patches, provider output, skills, plugins,
MCP servers, tool results, external messages, Hub commands, imported packages, and host
product state.

Required abuse cases include prompt injection into authority coordinates, path and symlink
escape, secret discovery or telemetry leakage, malicious capability dependencies, tool
schema substitution, event or receipt forgery, replay, cross-repository and cross-tenant
confusion, denial through hook latency or graph fan-out, cost amplification, poisoned
improvement candidates, and UI state presented as verified repository truth.

The minimum extension boundary is deny-by-default capability negotiation, exact package
and adapter identity, process isolation for third-party code, filesystem/network/resource
quotas, runtime-only credentials, bounded output, revocation, audit evidence, and a safe
local mode that does not require the extension. In-process built-ins remain reviewed
code, not a precedent for arbitrary dynamic module loading.

## Compatibility and historical meaning

Stable history requires more than a `schemaVersion` field. For each public contract,
define:

- the producer and consumer version range;
- whether unknown fields are ignored, retained, or rejected;
- additive groups and all-or-none validation;
- the migration owner, plan/apply binding, retry, and rollback behavior;
- how old evidence remains interpretable without gaining new meaning;
- minimum supported CLI, Node, Hub, adapter, and host-product combinations;
- upgrade and downgrade limits; and
- removal criteria based on observed use rather than elapsed time alone.

Golden fixtures should replay old events, snapshots, packages, and API exchanges through
new readers. Mixed-version tests should cover local-only operation, Node-Hub coordination,
host products, and provider adapters. A migration pass must be idempotent and a failed
upgrade must retain a verified predecessor.

## Evaluation and drift

Keep contract tests deterministic, then add versioned behavior evaluations for parts that
depend on models or external services. Record provider, model, adapter, prompt or protocol,
corpus, environment, and evaluator coordinates without storing private content in public
telemetry.

The common platform suite should include direct retrieval, managed read, managed write,
subagent handoff, approval, verification failure, crash recovery, offline operation,
upgrade, rollback, malicious extension, and host-product projection. Quality, duration,
usage completeness, safety, and repository effects remain separate gates. A stronger
model score cannot compensate for an authority, privacy, recovery, or compatibility
failure.

## References

- [Foundation-hardening entrypoint](../lervo-foundation-hardening.md)
- [System architecture](../../architecture/system.md)
- [Data ownership and failure boundaries](../../architecture/data-ownership-and-failure.md)
- [Execution specification](../../specifications/execution.md)
- [Local data and state lifecycle](../../specifications/execution/state-lifecycle.md)
- [Code convention](../../foundation/code-convention.md)
