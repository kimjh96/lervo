# Agent mentions, collaboration, and deliberation research

Status: `accepted input`

As of: 2026-08-30

## Context

This follow-up to the [Paperclip and Lervo comparison research](paperclip-lervo-comparison.md) identifies mentions as a first-class routing surface. Lervo already provides the underlying collaboration machinery; the missing piece is a conversational route into it.

## Existing foundation

Lervo contracts support durable agent identity, parent agents and subagents, assignments, dependencies, path-scoped parallel work, evidence-bound handoff, same-provider independent review, and cross-provider deliberation. See the [provider-neutral deliberation decision](../decisions/coordination/deliberation/0019-provider-neutral-deliberation.md) and [cross-provider runtime decision](../decisions/execution/providers/0029-cross-provider-deliberation-runtime.md).

Mentions should resolve to these contracts rather than create another collaboration engine.

## Routing model

```text
message with @mention
  -> resolve exact agent, role, manager, reviewer, verifier, team, or provider
  -> validate identity, role contract, authority, scope, budget, and policy
  -> route to inbox, assignment, handoff, escalation, or deliberation
  -> deliver at a safe message boundary
  -> record acknowledgment and subsequent action separately
```

Supported forms should include `@agent:<name>`, `@role:<role>`, `@manager`, `@reviewer`, `@verifier`, `@team:<name>`, and explicit `@debate` intent. Provider mentions such as `@codex` and `@claude` may nominate participants, but prose alone must not switch providers, authorize cost, start a paid run, or bypass provider-adapter boundaries.

## Collaboration and deliberation

Routine questions, progress requests, material delivery, delegation, and blocker escalation normally route to an inbox, assignment, or handoff. Competing designs, high-risk decisions, explicit rebuttal, independent cross-review, or requested consensus may initiate policy-bound deliberation.

Formal debate must remain explicit, bounded, and auditable; ordinary cooperation should remain lightweight.

## Evidence states

```text
mentioned -> resolved -> routed -> delivered -> acknowledged
                                      |
                                      +-> assignment_created -> acted_on
                                      +-> deliberation_started
                                          -> proposal_published
                                          -> objections_recorded
                                          -> verification_completed
                                          -> converged | no_consensus | failed
```

Each state is distinct. `delivered` does not prove understanding or action. Resolution does not prove assignment creation, proposal evaluation, or consensus.

## Authority boundaries

A mention cannot expand filesystem, network, provider, budget, or write authority. Resolution must use the current durable agent identity, role version and hash, scoped lease, policy, ancestry, and conflict checks.

Cross-provider deliberation requires an explicit typed workflow and policy.

## Recommendation

Add provider-neutral mention routing over existing agent, assignment, handoff, inbox, and deliberation primitives. Expose resolution, delivery, acknowledgment, assignment creation, and deliberation outcomes separately. This provides a Paperclip-like conversational surface while preserving Lervo's evidence, authority, and cross-provider guarantees.
