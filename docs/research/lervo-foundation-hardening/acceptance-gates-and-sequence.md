# Lervo foundation acceptance gates and sequence

Status: `accepted input`

As of: 2026-09-01

## Purpose

Turn foundation concerns into bounded proof instead of an open-ended architecture phase.
The gates below are proposed delivery criteria and do not change the completed v0 roadmap.
Their implementation sequence is now owned by the
[foundation-hardening roadmap](../../roadmap/foundation-hardening.md).

## Gate classes

### G0: authority and ownership

- One current map names the canonical owner, projection, retention, and mutation authority
  of every public entity.
- New goals, routines, loops, graph nodes, threads, and improvement candidates reuse
  existing workstream, assignment, run, event, and knowledge identities.
- No application database, graph, model memory, or search index becomes a second source
  of repository truth.

### G1: causal work and public contract

- A managed user request has one root coordinate and complete parent-child links through
  attempts, subagents, provider turns, tools, verification, and result.
- Unmanaged work remains explicitly unmanaged and missing links have typed reasons.
- The public command, query, event, subscription, failure, idempotency, and capability
  contracts have a published version and compatibility policy.
- The CLI and one local reference client consume this boundary without storage imports.

### G2: resource and latency evidence

- Managed golden journeys produce complete or typed-partial resource reports without
  double-counting cumulative provider usage.
- Primary work, subagents, Lervo overhead, verification, and deliberation remain separate.
- Estimated, provider-reported, billed, and unavailable cost states cannot be confused.
- Critical paths expose stage spans and representative cold, warm, scale, and concurrency
  baselines with p50, p95, p99, maximum, failure, CPU, and memory observations.
- Direct hooks satisfy the reviewed latency budget or remain availability-safe without a
  false success claim.

### G3: failure, concurrency, and recovery

- Every state-changing operation declares retry, cancellation, uncertainty, compensation,
  and recovery semantics.
- Failure injection proves exact completion, rollback, or `recovery_required` at every
  durable boundary.
- Duplicate delivery and repeated recovery are idempotent.
- Scheduler admission, queue bounds, fairness, deadlines, lease expiry, fan-out, joins,
  and backpressure have deterministic tests.

### G4: security and privacy

- An integrated threat model covers repository content, models, capabilities, external
  systems, products, and multi-repository or multi-tenant boundaries.
- Every telemetry field declares purpose, privacy, retention, cardinality, and export
  policy; secret and high-cardinality regression tests pass.
- Third-party extensions use an exact, revocable, resource-bounded isolation boundary and
  common conformance suite.
- Local execution and recovery remain possible without a Hub or extension.

### G5: compatibility, capacity, and drift

- Historical fixtures replay through current readers and mixed supported versions pass.
- Upgrade, failed upgrade, rollback, and migration idempotence are rehearsed.
- Small, medium, large, and concurrent-workforce profiles remain within published bounds;
  every growing collection has retention or compaction.
- Provider, model, retrieval, and adapter drift runs against frozen journeys before
  activation and through bounded post-activation observation.

## Delivery sequence

### Phase A: freeze meanings, not implementations

Inventory existing IDs, events, commands, ports, projections, and failure codes. Publish
the causal work envelope, ownership map, compatibility policy, and telemetry vocabulary.
Do not add new persistent product entities until G0 and the contract-definition portion
of G1 pass.

### Phase B: instrument current vertical paths

Add the resource ledger and stage spans to existing managed runs and direct hooks. Build
read-only request usage and performance projections. Capture representative baselines and
freeze reviewed budgets. This should improve visibility without adding autonomous effects
or monetary hard stops.

### Phase C: prove adverse behavior

Run crash, retry, cancellation, duplicate, concurrency, capacity, security, upgrade, and
rollback suites against current paths. Close semantic gaps found by those tests before a
loop can repeat them automatically. G2 through the core of G5 should pass here.

### Phase D: foundation readiness and handoff

Aggregate contract, replay, performance, recovery, security, capacity, packed-CLI,
fresh-clone, and local-without-Hub evidence. Review exact limitations and rollback before
declaring the foundation ready. Phases A through D correspond to FH0 through FH5 in the
implementation roadmap.

### Phase E: first enhancement slice

Extend the current assignment DAG with one versioned bounded flow:

```text
trigger -> checkpoint -> attempt -> observe -> verify
        -> complete | bounded retry | block | escalate
```

Use existing IDs, events, leases, verification, recovery, and public contracts. Include a
parallel branch, join, approval gate, cancellation, exhausted budget, and crash recovery
in the proof. The graph remains a rebuildable or declarative projection; observed state
and completion remain canonical elsewhere.

### Phase F: reference products and verified improvement

Build a minimal local operating client over the same public boundary. Then add bounded
Paperclip-like goals, routines, boards, and budgets and Buzz-like threads, mentions,
inboxes, and connectors as product projections and commands. Complete post-promotion
effect observation for verified improvement. Do not grant authority from presentation
membership, message delivery, model confidence, or remembered approval.

### Phase G: advanced and external capabilities

Only after measured need, consider dynamic graphs, unattended autonomy, external graph or
semantic services, more provider and harness adapters, and third-party host products.
Each enters through versioned ports, conformance tests, reviewed activation, rollback,
supersession, and migration.

## Go and no-go rule

The first durable loop or execution-graph enhancement proceeds only after the bounded
foundation roadmap and G0 through G5 are accepted. Later product features may use their
own narrower gates once that foundation exists.

The following are no-go conditions for durable loop or graph expansion:

- no common causal work root or retry identity;
- no public version and historical-reader policy;
- no typed distinction between observed, partial, unavailable, estimated, and billed
  resource data;
- no stage visibility on a critical path close to an external timeout;
- an effect can be retried after uncertainty without reconciliation;
- an extension can add authority, network, filesystem, or unbounded work implicitly; or
- crash recovery can produce both a success event and conflicting repository state.

## First recommended implementation scope

The first implementation roadmap should contain only:

1. the causal work-envelope contract and event compatibility policy;
2. provider-neutral usage aggregation and stage timing for existing paths;
3. read-only usage, latency, and missing-telemetry inspection;
4. a focused hook-latency diagnosis and safe budget;
5. common failure-injection and historical-replay harnesses; and
6. one aggregate foundation-readiness audit and enhancement handoff.

The governed-loop and assignment-graph vertical slice is the first subsequent
enhancement. Cost estimation, budget warnings, reference operating views, and
collaboration routes may follow as consumers. Billing reconciliation, hard monetary
stops, dynamic graph mutation, and unattended autonomy should remain later scopes.

## Completion evidence for a foundation milestone

Record exact contract and implementation versions, test and evaluation suite hashes,
environment profiles, measured percentiles, resource completeness, injected failures,
recovery outcomes, historical fixtures, security findings, remaining unsupported states,
and rollback evidence. A green repository check alone does not prove a foundation gate.

## References

- [Foundation-hardening entrypoint](../lervo-foundation-hardening.md)
- [Observability and performance](observability-and-performance.md)
- [Reliability, security, and compatibility](reliability-security-and-compatibility.md)
- [Agent platform and evolution research](../lervo-agent-platform-evolution.md)
- [Product positioning and verified improvement](../lervo-product-positioning-and-verified-improvement.md)
