# Lervo product positioning and verified improvement research

Status: `accepted input`

As of: 2026-09-01

## Purpose and scope

Synthesize lessons from Paperclip, Buzz, Prime Agent, and Hermes without expanding Lervo into a general-purpose assistant, collaboration database, or provider-specific agent runtime. Clarify repository knowledge retrieval and durable improvement without claiming that a model learns by itself or determines whether its learning is correct.

This research guides later refinement. It does not authorize runtime behavior, change the completed v0 roadmap, or replace responsible product, execution, knowledge, and lifecycle specifications.

[ADR-0417](../decisions/execution/applications/0417-own-discord-visible-reference-product.md) makes Discord the installed reference product surface and assigns Lervo a future first-party surface. Paperclip-like and Buzz-like products may remain separately installed; the reference experience is no longer solely external product scope.

## Positioning conclusion

Lervo is a headless, local-first control plane and extension platform for durable, governed, verifiable agent work in repositories. Its primary value is continuity and assurance across agents, providers, sessions, devices, and clean clones—not a smarter individual agent. Agents may change while repository context, scoped authority, work state, evidence, verification, and reviewed improvements remain available through canonical sources.

Product statement:

> Agents change. Repository truth remains.

Improvement statement:

> Not opaque agent memory, but verified repository improvement.

## Research topics

- [Product boundaries, adaptable ideas, and Hermes differentiation](lervo-product-positioning-and-verified-improvement/product-lessons.md)
- [Implemented retrieval, verified improvement, and safety boundaries](lervo-product-positioning-and-verified-improvement/retrieval-and-improvement.md)

The [agent-platform and evolution research](lervo-agent-platform-evolution.md) defines how governed loops, existing and future graphs, application surfaces, and rapidly changing AI techniques fit the product boundary.

## Deferred refinement sequence

This sequence is research guidance; the [product outcome convergence roadmap](../roadmap/product-outcome-convergence.md) tracks remaining outcomes and evidence.

1. Converge existing contracts behind a stable headless application boundary.
2. Define governed loops over workstreams, assignments, runs, and verification.
3. Extend current graph foundations into a bounded assignment execution graph.
4. Add reference operating and collaboration surfaces plus replaceable adapters.
5. Complete verified improvement, source-to-skill, and post-promotion evaluation.
6. Adopt advanced autonomy or external systems only through measured versioned contracts.

Name the future feature `verified improvement` or `evidence-bound improvement`, not `continual model learning`. Candidate surfaces should use `improvement candidate` or `canonicalization candidate`, not an unqualified `memory` or `learning inbox`.

## Sources and responsible Lervo contracts

External observations use official sources:

- [Paperclip core concepts](https://github.com/paperclipai/paperclip/blob/cec675ffca223789142593e9d79bcd26927759b2/docs/start/core-concepts.md)
- [Buzz README](https://github.com/block/buzz/blob/main/README.md) and [Buzz vision](https://github.com/block/buzz/blob/main/VISION.md)
- [Prime Agent repository](https://github.com/PrimeIntellect-ai/prime-agent), [RLM documentation](https://github.com/PrimeIntellect-ai/prime-agent/blob/main/packages/coding-agent/docs/rlm.md), and [long-running-agent documentation](https://github.com/PrimeIntellect-ai/prime-agent/blob/main/packages/coding-agent/docs/long-running-agents.md)
- [Hermes skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/), [memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/), and [tool-search documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/tool-search)

Lervo authority remains with the [product vision](../product/vision.md), [system architecture](../architecture/system.md), [execution specification](../specifications/execution.md), [repository knowledge specification](../specs/repository-knowledge-compilation.md), [knowledge lifecycle convergence specification](../specs/repository-knowledge-lifecycle-convergence.md), and [development-pattern lifecycle](../specs/repository-development-pattern-lifecycle.md). The [Paperclip comparison](paperclip-lervo-comparison.md) and [collaboration and mentions research](paperclip-lervo-collaboration-and-mentions.md) remain detailed inputs for their respective topics.
