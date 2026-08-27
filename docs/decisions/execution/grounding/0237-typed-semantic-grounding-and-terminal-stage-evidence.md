# ADR-0237: Typed semantic request grounding and terminal stage evidence

Status: `accepted`

## Context

Production request paths inferred intent, agent actions, capabilities, repository-knowledge queries, and deliberation from phrases or raw prompt tokens. Terminal preparation also collapsed recommendation, loading, hook preparation, provider injection, and provider use. Deliberation publication failures could obscure successful repository verification and leave the provider result without an official recovery path.

## Decision

The current provider adapter resolves raw request text and bounded prior context once, without tools, into `RequestGroundingV1`. Core code accepts only an exact-key typed proposal and deterministically validates the request digest, provider binding, intent, subjects, references, effects, prohibited effects, source classes, retrieval queries, workflow, capabilities, authority, ambiguity, and provider route. Provider-proposed protocol coordinates must already occur exactly in the request or bounded context. Repository paths use the explicit `repo-path:` coordinate. Unknown intent, unresolved references, ambiguity, invented coordinates, unavailable authority, or unauthorized cross-provider routing fail closed.

Lexical processing may rank candidate documents or capability packages only after the typed source plan exists. It cannot select semantic truth, workflow, effects, authority, providers, or capability activation. Workstream filename and heading heuristics remain continuation candidates only. Workforce planning, managed capability selection, terminal knowledge selection, and cross-provider deliberation all consume the typed decision.

Terminal context is separated into selection policy, hash-bound loading, bounded assembly, and telemetry. `terminal.context.prepared` records request and query digests, grounding status and coordinates, candidate count, selected/loading/preparation state, provider injection as `unobserved`, and provider use as `unknown`. Hook preparation is never delivery or use evidence.

Document rewriter protection derives from the document registry and reviewed normalization ownership. `lervo_generated`, `managed_blocks`, and reviewed-exact outputs are protected through one adapter contract; `.prettierignore` is only its managed projection. A non-Prettier rewriter must prove an unchanged content-bound dry run or fail closed.

Failed deliberation publication records `deliberation.artifact.publication_failed` with distinct producer and evaluator providers, role, attempt, repository-verification status, writing-publication status, failed checks, and the content hash of the quarantined CAS artifact. `lervo deliberate artifact --content-hash` is the supported recovery path. Missing verification configuration, repository verification failure, and writing publication failure use different diagnostics. `two-provider-v1` requires different proposer and reviewer providers.

## Consequences

Provider semantic quality remains measurable rather than encoded as phrase lists. Direct hook execution remains unmanaged and cannot prove provider acceptance or use. Capability lexical scoring remains only candidate retrieval. Cross-provider work requires the deliberation workflow and explicit authority. Historical events remain valid because the new terminal fields form an additive all-or-none group.

## Verification

- Request-grounding exact-key, digest, coordinate, ambiguity, authority, effect, capability, and provider-route tests.
- Workforce, managed capability, terminal integration, rewriter adapter, deliberation runtime, publication repair, and provider-diversity regression tests.
- The typed provider-observation semantic suite covers Korean, mixed-language, indirect reference, ambiguity, authority, source drift, and adversarial projection cases without implementing a lexical router.
- `pnpm routing:semantic:check` audits known production raw-language routing surfaces and records bounded exceptions.
