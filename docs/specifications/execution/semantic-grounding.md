# Typed Semantic Request Grounding

Status: `active`
As of: 2026-08-27

## Boundary

Natural-language execution begins at the current provider adapter. Only that adapter may transiently see the raw request and bounded prior turns. It returns an exact-key `RequestGroundingV1` proposal. Core execution never receives raw prompt text, routing keyword lists, aliases, or synonyms.

The deterministic resolver validates request and provider binding, exact protocol coordinates, intent, subjects and references, requested and prohibited effects, source needs, workflows, capability candidates, authority, ambiguity, and provider routes. Unknown intent, unresolved references, invented coordinates, unavailable authority, and unapproved cross-provider routing fail closed.

## Pipeline

```text
raw request + bounded prior turns + current workstream + authority
-> exact structured-coordinate extraction
-> current-provider semantic proposal
-> deterministic typed validation
-> workflow and source plan
-> candidate retrieval
-> exact approved apply
```

Only agent, assignment, workstream, approval, and deliberation IDs; safe explicit `repo-path:` coordinates; and CLI or schema enums may be recognized by exact syntax. Lexical processing may retrieve or rank candidate documents and capability packages only after typed source and capability needs exist. It cannot establish semantic truth, target, workflow, effect, authority, provider choice, or activation.

The same provider handles grounding by default. Cross-provider execution requires a typed deliberation workflow, explicit policy and authority, and distinct proposer and reviewer providers. Any approved single-provider degradation must be explicit, not inferred.

## Consumers and Evidence

Workforce planning, managed capability selection, terminal knowledge selection, and deliberation routing consume the validated decision. Typed source needs and authority restrict context selection before loading.

Managed search records operational and repository-knowledge recommendations separately. If an AGENTS instruction or registered document appears in both, injection discovery must resolve one canonical document ID with identical metadata. Unproven same-path identity fails before the turn.

Terminal context stages remain distinct: candidates, selection, loading, hook-side preparation, provider delivery or injection, and provider use. Preparation is observable; direct-provider delivery is unobserved, and use is unknown. Neither may be inferred from earlier stages.

See [ADR-0237](../../decisions/execution/grounding/0237-typed-semantic-grounding-and-terminal-stage-evidence.md) for the decision and verification evidence.
