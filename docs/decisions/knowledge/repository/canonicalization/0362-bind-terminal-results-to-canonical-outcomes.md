# ADR-0362: Bind terminal results to canonical outcomes

- Status: accepted
- Date: 2026-09-04

Amended by: [ADR-0533](patterns/0533-remove-the-development-pattern-pipeline.md). Pattern-specific intake and command behavior is retired; shared contracts remain.

## Context

Terminal finalization previously accepted a broad canonicalization disposition and inferred responsibility only from changed path classes. A change to any canonical document of the same class could suppress an unrelated candidate. When no canonical document changed, the candidate recorded source metadata without an agent-authored durable outcome or reviewable draft. The claim that a result was knowledgeized therefore exceeded the installed contract.

Direct Codex and Claude sessions remain unmanaged. Lervo can validate bytes and explicit bounded claims, but it cannot infer model understanding or automatically write user-owned truth.

## Decision

Every repository-changing `lervo terminal declare` requires one local `canonicalizationOutcome` object in addition to the event-safe disposition:

- `canonical_update` binds every changed noncanonical source exactly once to one changed canonical target path and its exact current content hash.
- `no_durable_change` binds every changed noncanonical source exactly once to a bounded reason and creates a review candidate rather than self-approving the absence of durable knowledge.
- `review_draft` binds every changed noncanonical source exactly once to a responsibility-compatible canonical target, proposed Markdown, and exact proposed-content hash.

The outcome kind must match the declared disposition. Target and source paths must be repository-relative, unique, bounded, and responsibility-compatible. Changed canonical targets must exist in the final repository snapshot and match their declared hashes. Missing, duplicated, stale, or unbound source coordinates reject the declaration.

Outcome bodies remain only in gitignored canonicalization candidate state. The `terminal.turn.declared` event retains its existing privacy-bounded fields and does not receive the summary or proposed Markdown. The candidate's exact content hash remains the review binding.

Promotion requires an already-written compatible canonical target and verifies its exact current hash. Lervo never implicitly turns a draft into user-owned truth.

Legacy candidates without an outcome remain readable and are labeled metadata-only by projections. New candidates include the outcome in their stable identity. Stale candidates allow exact-hash rejection but never deferral or promotion. Promoted and rejected candidate records become eligible for the existing exact derived-state retention policy; unresolved candidates remain protected.

## Consequences

- An agent cannot omit a changed source from its canonicalization claim.
- A canonical update identifies exact responsible targets instead of relying only on document class.
- Work requiring authority carries a concrete local draft that the next agent can inspect and proactively present through operating attention.
- The outcome remains an unmanaged agent proposal. It proves neither semantic correctness nor model understanding; review remains separate from promotion.

## Verification

Domain tests cover complete source binding, omitted-source rejection, exact target hashes, bounded draft persistence, stale rejection, and terminal candidate retention. Direct-terminal integration must prove the generated instruction, required outcome declaration, candidate creation, and next-prompt attention journey. The packed external consumer additionally proves preparation, draft declaration, local inspection, proactive attention, exact target writing and promotion, and resolved attention using only the installed CLI boundary.
