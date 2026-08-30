# Typed Semantic Request Grounding

Status: `active`
As of: 2026-08-27

## Boundary

Natural-language execution begins at the current provider adapter. Only that adapter may transiently access the raw request and bounded prior turns. It returns an exact-key `RequestGroundingV1` proposal. Core execution never receives raw prompt text, routing keyword lists, aliases, or synonyms.

The deterministic resolver validates:

- request and provider binding;
- exact protocol coordinates;
- intent, subjects, and references;
- requested and prohibited effects;
- source needs and workflows;
- capability candidates and authority;
- ambiguity and provider routes;
- durable-instruction speech act, authority, duration, operation, scope, risk, conflict, and confidence.

Unknown intent, unresolved references, invented coordinates, unavailable authority, and unapproved cross-provider routing fail closed.

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

Only these may be recognized by exact syntax:

- agent, assignment, workstream, approval, and deliberation IDs;
- safe explicit `repo-path:` coordinates;
- CLI or schema enums.

Lexical processing may retrieve or rank candidate documents and capability packages only after typed source and capability needs exist. It cannot establish semantic truth, target, workflow, effect, authority, provider choice, or activation.

The same provider handles grounding by default. Cross-provider execution requires a typed deliberation workflow, explicit policy and authority, and distinct proposer and reviewer providers. Any approved single-provider degradation must be explicit, not inferred.

The provider adapter receives the complete nested response schema and deterministically validates the proposal. Process, parsing, binding, or proposal-validation failure produces the stable adapter failure `semantic_resolution_failed`, containing no raw request, provider output, configuration, or unrestricted error.

Managed consumers reject `semantic_resolution_failed`. Only unmanaged direct terminal preparation translates it to `abstain`, with empty workflow, effect, capability, provider, authority, source, subject, and retrieval coordinates. This permits conversation without authorizing semantic action or publication selection.

Direct terminal provider resolution is limited to 20 seconds within the 30-second hook budget. Repository, evidence, and workspace failures remain blocking.

For direct terminal requests, the adapter receives a bounded catalog of existing canonical instructions. A durable rule may be materialized only when that catalog is complete and the validated proposal identifies one explicit, additive, low-risk, repository-long user directive with high confidence and no ambiguity or conflict. The gate rejects examples, quotations, hypotheticals, complaints, questions, current-task commands, inferred preferences, replacement, removal, and high-risk policy. The provider normalizes rule content, but prompt text and lexical routing fields never cross the grounding boundary or enter the canonical file.

## Consumers and Evidence

Workforce planning, managed capability selection, terminal knowledge selection, and deliberation routing consume the validated decision. Typed source needs and authority restrict context selection before loading.

Managed search records operational and repository-knowledge recommendations separately. If an AGENTS instruction or registered document appears in both, injection discovery must resolve one canonical document ID with identical metadata. Unproven same-path identity fails before the turn.

Terminal context stages remain distinct:

1. candidates;
2. selection;
3. loading;
4. hook-side preparation;
5. provider delivery or injection;
6. provider use.

Preparation is observable. Direct-provider delivery is unobserved, and provider use is unknown. Neither may be inferred from an earlier stage.

See [ADR-0237](../../decisions/execution/grounding/0237-typed-semantic-grounding-and-terminal-stage-evidence.md) and [ADR-0239](../../decisions/execution/grounding/0239-unmanaged-terminal-grounding-failure-abstention.md) for decisions and verification evidence.
