# ADR-0237: Typed semantic request grounding and terminal stage evidence

Status: `accepted`

## Context

Production request paths inferred intent, agent actions, capabilities, repository-knowledge queries, and deliberation from phrases or raw prompt tokens. Terminal preparation collapsed recommendation, loading, hook preparation, provider injection, and provider use. Deliberation publication failures could obscure successful repository verification and leave provider results without an official recovery path.

## Decision

The provider adapter resolves raw request text and bounded prior context once, without tools, into `RequestGroundingV1`. Core code accepts only an exact-key typed proposal and deterministically validates the request digest, provider binding, intent, subjects, references, effects, prohibited effects, source classes, retrieval queries, workflow, capabilities, authority, ambiguity, and provider route. Provider-proposed protocol coordinates must occur exactly in the request or bounded context. Repository paths use the explicit `repo-path:` coordinate. Unknown intent, unresolved references, ambiguity, invented coordinates, unavailable authority, and unauthorized cross-provider routing fail closed.

Lexical processing may rank candidate documents or capability packages only after the typed source plan exists. It cannot select semantic truth, workflow, effects, authority, providers, or capability activation. Workstream filename and heading heuristics remain continuation candidates only. Workforce planning, managed capability selection, terminal knowledge selection, and cross-provider deliberation consume the typed decision.

Terminal context is divided into selection policy, hash-bound loading, bounded assembly, and telemetry. `terminal.context.prepared` records request and query digests, grounding status and coordinates, candidate count, selected/loading/preparation state, provider injection as `unobserved`, and provider use as `unknown`. Hook preparation is never evidence of delivery or use.

Document rewriter protection derives from the document registry and reviewed normalization ownership. `lervo_generated`, `managed_blocks`, and reviewed-exact outputs are protected through one adapter contract. ADR-0303 removed the tracked `.prettierignore` projection; formatter, autofix, transform, and generator adapters consume neutral ownership rules. An unbound rewriter must prove an unchanged content-bound dry run or fail closed.

Failed deliberation publication records `deliberation.artifact.publication_failed` with distinct producer and evaluator providers, role, attempt, repository-verification status, writing-publication status, failed checks, and the quarantined CAS artifact's content hash. `lervo deliberate artifact --content-hash` is the supported recovery path. Missing verification configuration, repository verification failure, and writing publication failure have distinct diagnostics. `two-provider-v1` requires different proposer and reviewer providers.

## Consequences

Provider semantic quality remains measurable instead of being encoded as phrase lists. Direct hook execution remains unmanaged and cannot prove provider acceptance or use. Capability lexical scoring remains limited to candidate retrieval. Cross-provider work requires the deliberation workflow and explicit authority. Historical events remain valid because the new terminal fields are an additive all-or-none group.

## Verification

- Test request-grounding exact keys, digests, coordinates, ambiguity, authority, effects, capabilities, and provider routes.
- Run workforce, managed capability, terminal integration, rewriter adapter, deliberation runtime, publication repair, and provider-diversity regression tests.
- The typed provider-observation semantic suite covers Korean, mixed-language, indirect-reference, ambiguity, authority, source-drift, and adversarial-projection cases without implementing a lexical router.
- `pnpm routing:semantic:check` audits known production raw-language routing surfaces and records bounded exceptions.
