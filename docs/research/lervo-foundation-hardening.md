# Lervo foundation-hardening research

Status: `accepted input`

As of: 2026-09-01

## Objective

Consolidate Lervo's product direction across Paperclip, Buzz, Prime Agent, Hermes, verified improvement, loop engineering, and graph engineering, then identify foundations to harden before broader platform work makes correction costly.

This research does not authorize runtime behavior, reopen the completed v0 roadmap, or declare proposed acceptance gates implemented. Implementation-ready direction is tracked by the [foundation-hardening roadmap](../roadmap/foundation-hardening.md) and [ADR-0331](../decisions/operations/trace/0331-adopt-reader-first-causal-work-observability.md).

## Consolidated product definition

Lervo is a headless, local-first control plane and extension platform for durable, governed, verifiable repository-agent work.

It owns repository work truth: canonical knowledge, identity, authority, assignments, workstreams, evidence, verification, recovery, and reviewed improvement. It should provide stable primitives and replaceable adapters for Paperclip-like operating products and Buzz-like collaboration products without copying every interface or making application databases authoritative.

Prime Agent-, Hermes-, Codex-, and Claude-like agents may execute below Lervo. Models, providers, harnesses, context techniques, retrieval methods, skills, tool protocols, execution targets, and user interfaces remain replaceable edges. Rapid AI change is a reason to stabilize authority and evidence semantics, not freeze a current technique into the core.

Lervo does not claim that a model learns by itself or learned correctly. It supports evidence-bound improvement: observed work may produce a source-bound candidate, but promotion and continued use remain controlled by review, verification, ownership, current state, and later outcome evidence.

> Agents change. Repository truth remains.

> Not opaque agent memory, but verified repository improvement.

## What is already strong

The existing foundation should be converged, not replaced:

- Canonical Markdown, repository state, policies, events, and CAS artifacts are authoritative; graphs, indexes, and read models are rebuildable.
- Provider behavior remains behind Codex and Claude adapters with common evidence states.
- `selected`, `loaded`, `injected`, `referenced`, and `used` remain distinct.
- Plans bind exact content; managed writes use approval, verification, journals, and recovery.
- Workstreams, agents, assignments, ancestry, leases, path conflicts, and handoffs have durable identities and bounded state.
- Search is request-aware, current-repository-scoped, exact-hash-bound, locally recoverable, and versioned behind ports.
- Generated, managed-block, and user-owned document bytes have distinct ownership.
- Local execution does not require a Hub or host product.

The next step is to make these contracts coherent, measurable, evolvable, and provable as one platform boundary, not perform a ground-up rewrite.

## The irreversibility test

Foundation work covers concerns whose deferral would require rewriting durable history, changing old evidence meanings, migrating every adapter and product, or breaking user authority:

1. one causal work identity spanning user request, workstream, assignment, attempt, provider turn, tool, subagent, verification, and result;
2. versioned public command, query, event, capability, and failure contracts;
3. explicit resource and performance evidence, including typed `unknown` states;
4. crash, retry, cancellation, idempotency, and uncertain-effect semantics;
5. concurrency, backpressure, capacity, and bounded-growth rules;
6. an integrated threat model and isolation contract for untrusted repositories, providers, skills, plugins, MCP servers, and external products;
7. compatibility, migration, rollback, and historical replay across releases; and
8. reproducible evaluation that detects model, provider, retrieval, and adapter drift.

Detailed requirements are in [observability and performance](lervo-foundation-hardening/observability-and-performance.md) and [reliability, security, and compatibility](lervo-foundation-hardening/reliability-security-and-compatibility.md).

## What should happen before advanced product work

Foundation hardening should be staged rather than treated as an indefinite prerequisite.

### Contract before persistence

Before adding durable loop, graph, goal, routine, thread, or budget state, define common work identity, public contract versioning, event meaning, ownership, privacy, failure, and migration rules. This prevents permanent parallel task, workflow, memory, or truth stores.

### Measurement before optimization

Instrument current managed and unmanaged paths before choosing optimizations. A hook completing below its provider timeout is not an adequate speed contract. A provider-reported token count is not necessarily a bill, cost estimate, or cross-provider comparison.

### Failure proof before unattended autonomy

Exercise crash points, stale retries, cancellations, duplicate delivery, partial cleanup, lease expiry, external uncertainty, and recovery on the exact transitions used by an unattended loop. Autonomous continuation must not amplify ambiguous state.

### Foundation completion before the first enhancement slice

Complete the bounded foundation roadmap before implementing a governed loop or richer assignment execution graph. Then build one vertical slice through the same public contracts used by the CLI; a minimal local operating view may consume it. Broader Paperclip-like and Buzz-like interfaces should follow only after proving that products do not require storage internals or separate authority.

See [acceptance gates and delivery sequence](lervo-foundation-hardening/acceptance-gates-and-sequence.md).

## Immediate conclusion

Do not begin with a large workflow engine, graph database, dashboard, or autonomous agent layer. First stabilize the causal work envelope, public evolution rules, resource ledger, stage-level performance evidence, and cross-cutting failure contract. Then use a small governed loop and execution graph as the first enhancement built on the completed foundation.

This preserves momentum while protecting durable identifiers, event meanings, authority, public contracts, and historical compatibility—the elements most expensive to change later.

## Related research and authority

The [product positioning and verified-improvement research](lervo-product-positioning-and-verified-improvement.md) contains the complete Paperclip, Buzz, Prime Agent, and Hermes comparison. The [agent-platform and evolution research](lervo-agent-platform-evolution.md) owns the headless platform, graph, loop, and rapid-AI-evolution direction.

Implemented authority remains with the [product vision](../product/vision.md), [system architecture](../architecture/system.md), [execution specification](../specifications/execution.md), [provider-adapter specification](../specifications/execution/provider-adapters.md), and [v0 roadmap](../roadmap/v0.md).
