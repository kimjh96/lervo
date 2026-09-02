# Lervo product positioning and verified improvement research

Status: `accepted input`

As of: 2026-09-01

## Objective

Synthesize the useful product lessons from Paperclip, Buzz, Prime Agent, and Hermes
without widening Lervo into another general-purpose assistant, collaboration database,
or provider-specific agent runtime. Clarify how Lervo should describe repository
knowledge retrieval and durable improvement without claiming that a model learns by
itself or determines that its own learning is correct.

This document records research direction for later refinement. It does not authorize
new runtime behavior, change the completed v0 roadmap, or replace the responsible
product, execution, knowledge, and lifecycle specifications.

## Positioning conclusion

Lervo is a headless, local-first control plane and extension platform for durable,
governed, and verifiable agent work in repositories.

Its primary value is not a smarter individual agent. It is continuity and assurance
across agents, providers, sessions, devices, and clean clones. Agents may change while
repository context, scoped authority, work state, evidence, verification, and reviewed
improvements remain available through canonical sources.

The concise product statement is:

> Agents change. Repository truth remains.

The sharper improvement statement is:

> Not opaque agent memory, but verified repository improvement.

## Product boundaries

| Product     | Primary layer                                        | Lesson for Lervo                                                                                                                         | Boundary to preserve                                                                                                                                   |
| ----------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Paperclip   | Agent-organization operations                        | Goals, projects, issues, routines, budgets, and an approachable operating view                                                           | Project a view over Lervo contracts; do not make an application database the authority for repository truth                                            |
| Buzz        | Shared human-agent workspace                         | Rooms, threads, mentions, workflows, searchable events, and agents as collaboration participants                                         | Route interaction into identity, assignment, authority, evidence, and handoff contracts; channel membership alone must not expand repository authority |
| Prime Agent | Long-running execution harness                       | Resumable sessions, bounded autonomous continuation, subagents, direct agent communication, goals, heartbeats, and reviewable refinement | Keep provider behavior behind adapters and convert runtime lessons into reviewable candidates rather than self-modifying the core                      |
| Hermes      | Adaptive personal agent                              | Progressive skill disclosure, tool search, session recall, durable memory, agent-managed skills, and approval gates                      | Do not treat personal memory or agent-authored skills as canonical repository truth                                                                    |
| Lervo       | Repository agent-work control and extension platform | Knowledge, identity, policy, workstreams, assignments, evidence, verification, and portable continuity                                   | Remain local-first, provider-neutral, canonical-source-led, extensible, and explicit about unobservable behavior                                       |

These products are not one replacement hierarchy. Paperclip-like operating views and
Buzz-like collaboration surfaces can sit above Lervo. Prime Agent, Hermes, Codex, and
Claude can operate below it through provider and execution adapters. This is a
responsibility model, not a required dependency graph or an integration commitment to
any named product. The [agent-platform and evolution research](lervo-agent-platform-evolution.md)
defines how governed loops, existing and future graphs, application surfaces, and
rapidly changing AI techniques fit this boundary.

## Existing request-aware repository retrieval

Lervo already provides the foundation for finding repository documents that fit a
natural-language request. The current flow projects a request into bounded queries,
retrieves only registered current-repository knowledge, ranks and selects candidates,
loads exact current bytes, and prepares bounded context for a managed adapter or direct
terminal hook.

```text
natural-language request
  -> provider-neutral query projection
  -> qualified current-repository retrieval
  -> bounded candidate ranking and selection
  -> exact-hash load
  -> managed delivery or unmanaged hook preparation
```

This capability is already implemented; it is not part of the proposed future
improvement scope. Its evidence language remains deliberately narrow:

- discovery does not prove selection;
- selection does not prove loading;
- loading does not prove provider injection;
- injection or hook preparation does not prove reference, understanding, correctness,
  or semantic use; and
- an empty current-repository result says nothing about another repository or external
  service.

Future refinement should measure missed relevant sources, unnecessary selected sources,
exact output references, and downstream task outcomes. It must not collapse those
observations into a single unsupported claim that the model used the right document.

## Improvement is not model self-learning

The phrases `the model learns by itself` and `the model correctly learned` are not valid
descriptions of Lervo:

1. Lervo does not update provider model weights.
2. An agent cannot make its own output canonical merely by remembering or repeating it.
3. Correctness requires source responsibility, current repository state, review,
   verification, and bounded outcome evidence.
4. A stored memory, generated summary, repeated proposal, or provider agreement is not
   semantic truth.

The existing canonicalization assessment and development-pattern lifecycle already own
the durable part of improvement. A repository-changing result can be assessed against
its responsible canonical target. Reusable patterns become source-bound candidates and
move through exact review and promotion; they never modify user-owned canonical content
solely because an agent proposed them.

The correct product term is **evidence-bound improvement**, expressed as a **verified
improvement loop**:

```text
task observation
  -> scoped improvement or canonicalization candidate
  -> provenance, conflict, ownership, and verification review
  -> promote, reject, defer, or supersede
  -> canonical repository source
  -> knowledge refresh and later retrieval
  -> bounded post-promotion effect observation
```

The first five transitions reuse existing Lervo contracts. The version-1 verified-effect
contract now pre-registers a baseline and compares observable source recall, unnecessary
context, verification success, repeated failure, rework, and user correction after exact
promotion. Attribution remains unestablished, and unfavorable evidence requests review rather
than automatic rollback. Production observation adapters and stronger causal designs remain
future work.

## Adaptable ideas

### From Paperclip

- Build a deterministic operating board over workstreams, agents, assignments, blockers,
  approvals, verification, usage, and cost.
- Add objectives and routines only when they resolve to bounded Lervo work and authority.
- Prefer warnings and inspectable projections before introducing hard monetary stops.

### From Buzz

- Add threads, mentions, inbox routing, and acknowledgments over existing agent identity,
  assignment, handoff, and deliberation contracts.
- Keep message delivery, acknowledgment, assignment creation, action, and verified result
  as separate states.
- Let people and agents share a collaboration surface without giving them identical
  repository capabilities merely because they share a room.

### From Prime Agent

- Support attach, detach, resume, goals, heartbeats, and bounded autonomous continuation
  over a current workstream.
- Allow recursive workers and direct messages only through durable identity, ancestry,
  scoped leases, path-conflict checks, evidence, and finalization.
- Represent runtime refinement as reviewable supplemental instructions, skill candidates,
  or agent-profile candidates; never as unreviewed core self-modification.

### From Hermes

- Extend progressive disclosure from repository documents to capabilities and tool
  schemas so only relevant definitions consume context.
- Offer source-to-skill candidate creation from a user-selected source, while preserving
  source hashes, permissions, resources, review, and activation evidence.
- Reuse approval history only as a policy candidate signal. Prior approval does not grant
  new authority.
- Preserve the distinction among recommendation, selection, verified loading, provider
  activation, invocation, and semantic use.

## Differentiation from Hermes

Hermes may remain stronger as a broad personal assistant with conversational memory,
messaging, immediate adaptation, and many built-in tools. Lervo should not compete on
that entire surface.

Lervo can be stronger for repository and agent-workforce improvement when it provides:

- canonical sources rather than hidden personal memory;
- exact provenance, scope, ownership, and approval;
- provider-neutral evidence across different agents and runtimes;
- stale detection, rejection, supersession, and rollback;
- verification-bound promotion instead of agent confidence;
- scoped reuse by a repository workforce rather than one assistant profile;
- reproducibility on another device or clean clone without a Hub; and
- post-promotion outcome measurement.

The intended contrast is therefore:

> Hermes remembers and adapts quickly. Lervo enables a repository and its agent
> workforce to improve safely from evidence.

This is a scoped differentiation claim, not a claim that Lervo is universally better
than Hermes.

## Deferred refinement sequence

The following order is research guidance, not accepted delivery scope:

1. Converge existing contracts behind a stable headless application boundary.
2. Define governed loops over workstreams, assignments, runs, and verification.
3. Extend the current graph foundations into a bounded assignment execution graph.
4. Add reference operating and collaboration surfaces plus replaceable adapters.
5. Complete verified improvement, source-to-skill, and post-promotion evaluation.
6. Adopt advanced autonomy or external systems only through measured versioned contracts.

The future feature should be named `verified improvement` or `evidence-bound
improvement`, not `continual model learning`. Candidate surfaces should use terms such as
`improvement candidate` or `canonicalization candidate`, not an unqualified `memory` or
`learning inbox`.

## Safety boundaries

- Do not introduce a second knowledge authority alongside canonical repository sources.
- Do not automatically promote personal memory, conversation summaries, or agent-authored
  skills into repository truth.
- Do not infer semantic use, understanding, or correctness from context delivery.
- Do not let natural language, repeated approval, a mention, or room membership expand
  filesystem, network, provider, budget, or write authority.
- Do not couple core evidence or improvement contracts to Prime Agent, Hermes, Codex,
  Claude, Paperclip, Buzz, or any other product.
- Do not freeze a current model, agent pattern, protocol, retrieval method, or AI trend
  into the core when a versioned port and reviewed adapter can preserve replacement.
- Do not obscure unmanaged work behind managed-sounding product language.

## Sources and responsible Lervo contracts

External observations use the official [Paperclip core concepts](https://github.com/paperclipai/paperclip/blob/cec675ffca223789142593e9d79bcd26927759b2/docs/start/core-concepts.md),
[Buzz README](https://github.com/block/buzz/blob/main/README.md),
[Buzz vision](https://github.com/block/buzz/blob/main/VISION.md),
[Prime Agent repository](https://github.com/PrimeIntellect-ai/prime-agent),
[Prime Agent RLM documentation](https://github.com/PrimeIntellect-ai/prime-agent/blob/main/packages/coding-agent/docs/rlm.md),
[Prime Agent long-running-agent documentation](https://github.com/PrimeIntellect-ai/prime-agent/blob/main/packages/coding-agent/docs/long-running-agents.md),
[Hermes skills documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/),
[Hermes memory documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/),
and [Hermes tool-search documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/tool-search).

Lervo authority remains with the [product vision](../product/vision.md),
[system architecture](../architecture/system.md),
[execution specification](../specifications/execution.md),
[repository knowledge specification](../specs/repository-knowledge-compilation.md),
[knowledge lifecycle convergence specification](../specs/repository-knowledge-lifecycle-convergence.md),
and [development-pattern lifecycle](../specs/repository-development-pattern-lifecycle.md).
The existing [Paperclip comparison](paperclip-lervo-comparison.md) and
[collaboration and mentions research](paperclip-lervo-collaboration-and-mentions.md)
remain the detailed inputs for their respective topics.
