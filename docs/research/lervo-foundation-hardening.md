# Lervo foundation-hardening research

Status: `accepted input`

As of: 2026-09-01

## Objective

Consolidate the Lervo product direction discussed across Paperclip, Buzz, Prime Agent,
Hermes, verified improvement, loop engineering, and graph engineering, then identify the
foundation that should be hardened before broader platform work makes correction costly.

This document is research guidance. It does not authorize runtime behavior, reopen the
completed v0 roadmap, or declare the proposed acceptance gates implemented.

## Consolidated product definition

Lervo is a headless, local-first control plane and extension platform for durable,
governed, and verifiable agent work in repositories.

It owns repository work truth: canonical knowledge, identity, authority, assignments,
workstreams, evidence, verification, recovery, and reviewed improvement. It should
provide stable primitives and replaceable adapters from which Paperclip-like operating
products and Buzz-like collaboration products can be built. It should not copy every
interface or make their application databases authoritative.

Prime Agent-, Hermes-, Codex-, and Claude-like agents may execute below Lervo. Models,
providers, harnesses, context techniques, retrieval methods, skills, tool protocols,
execution targets, and user interfaces remain replaceable edges. Rapid AI change is a
reason to stabilize Lervo's authority and evidence semantics, not to freeze a current AI
technique into the core.

Lervo does not claim that a model learns by itself or correctly learned. It supports
evidence-bound improvement: observed work may produce a source-bound candidate, but
review, verification, ownership, current state, and later outcome evidence control
promotion and continued use.

The durable product statements remain:

> Agents change. Repository truth remains.

> Not opaque agent memory, but verified repository improvement.

## What is already strong

The repository already contains substantial foundation that should be converged rather
than replaced:

- canonical Markdown, repository state, policies, events, and CAS artifacts remain
  authoritative while graphs, indexes, and read models are rebuildable;
- provider behavior stays behind Codex and Claude adapters with common evidence states;
- `selected`, `loaded`, `injected`, `referenced`, and `used` are not collapsed;
- plans bind exact content and managed writes use approval, verification, journals, and
  recovery;
- workstreams, agents, assignments, ancestry, leases, path conflicts, and handoffs have
  durable identities and bounded state;
- search is request-aware, current-repository-scoped, exact-hash-bound, locally
  recoverable, and versioned behind ports;
- generated, managed-block, and user-owned document bytes have distinct ownership; and
- local execution does not require a Hub or host product.

This means the next step is not a ground-up rewrite. It is to make the existing contracts
coherent, measurable, evolvable, and provable as one platform boundary.

## The irreversibility test

A concern belongs in foundation work when postponing it would require rewriting durable
history, changing the meaning of old evidence, migrating every adapter and product, or
breaking user authority to correct it later.

Under that test, the highest-priority foundations are:

1. one causal work identity from user request through workstream, assignment, attempt,
   provider turn, tool, subagent, verification, and result;
2. versioned public command, query, event, capability, and failure contracts;
3. explicit resource and performance evidence, including typed `unknown` states;
4. crash, retry, cancellation, idempotency, and uncertain-effect semantics;
5. concurrency, backpressure, capacity, and bounded-growth rules;
6. an integrated threat model and isolation contract for untrusted repositories,
   providers, skills, plugins, MCP servers, and external products;
7. compatibility, migration, rollback, and historical replay across releases; and
8. reproducible evaluation that detects model, provider, retrieval, and adapter drift.

Detailed observations and requirements are split into
[observability and performance](lervo-foundation-hardening/observability-and-performance.md)
and [reliability, security, and compatibility](lervo-foundation-hardening/reliability-security-and-compatibility.md).

## What should happen before advanced product work

Foundation hardening should be staged, not treated as an indefinite prerequisite.

### Contract before persistence

Before adding new durable loop, graph, goal, routine, thread, or budget state, define the
common work identity, public contract versioning, event meaning, ownership, privacy,
failure, and migration rules. This prevents parallel task, workflow, memory, or truth
stores from becoming permanent.

### Measurement before optimization

Instrument the current managed and unmanaged paths before selecting optimizations. A
hook merely completing below its provider timeout is not an adequate speed contract.
Likewise, a provider-reported token count is not a bill, a cost estimate, or necessarily
comparable with another provider.

### Failure proof before unattended autonomy

Exercise crash points, stale retries, cancellations, duplicate delivery, partial cleanup,
lease expiry, external uncertainty, and recovery on the exact state transitions an
unattended loop would use. Autonomous continuation should not amplify an ambiguous state.

### One vertical slice before broad interfaces

After the minimum foundation gates pass, implement one governed-loop and bounded
assignment-execution-graph slice through the same public contracts used by the CLI. A
minimal local operating view may consume that slice. Broader Paperclip-like and
Buzz-like interfaces should follow only after this proves that products do not need
storage internals or separate authority.

The proposed gates and sequence are in
[acceptance gates and delivery sequence](lervo-foundation-hardening/acceptance-gates-and-sequence.md).

## Immediate conclusion

Do not begin by building a large workflow engine, graph database, dashboard, or autonomous
agent layer. First stabilize the causal work envelope, public evolution rules, resource
ledger, stage-level performance evidence, and cross-cutting failure contract. Then use a
small governed loop and execution graph as the first proof of that foundation.

This preserves momentum while protecting the parts that are physically expensive to
change later: durable identifiers, event meanings, authority, public contracts, and
historical compatibility.

## Related research and authority

The [product positioning and verified-improvement research](lervo-product-positioning-and-verified-improvement.md)
contains the complete Paperclip, Buzz, Prime Agent, and Hermes comparison. The
[agent-platform and evolution research](lervo-agent-platform-evolution.md) owns the
headless platform, graph, loop, and rapid-AI-evolution direction.

Implemented authority remains with the [product vision](../product/vision.md),
[system architecture](../architecture/system.md),
[execution specification](../specifications/execution.md),
[provider-adapter specification](../specifications/execution/provider-adapters.md), and
[v0 roadmap](../roadmap/v0.md).
