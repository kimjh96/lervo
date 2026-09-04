# ADR-0366: Refine canonicalization and governed-work decision routes

Status: `accepted`  
Date: 2026-09-04

## Context

Adding evidence-bound result canonicalization and workstream-goal projection took the `knowledge/repository` and `execution/orchestration` decision leaves beyond the reviewed 24-document limit. Raising the limit would obscure two independently evolving responsibilities: canonical knowledge outcomes and governed assignment operation.

Improvement-effect decisions also remained in the broad orchestration leaf after the improvement route became their canonical semantic owner.

## Decision

Add `knowledge.repository.canonicalization` for knowledge candidates, canonicalization, and exact canonical outcomes. Move ADR-0030, ADR-0303, and ADR-0362 there without changing their identities or decisions.

Add `execution.orchestration.governed-work` for the governed loop, assignment authority and completion, operator projections, assignment interactions and routines, connector delivery, and workstream-backed goals. Move ADR-0336 through ADR-0344 where applicable, ADR-0347, and ADR-0365 to that route. Move ADR-0345 and ADR-0346 to the existing improvement route.

Keep the 24-document leaf limit unchanged. Update authored references and rebuild generated knowledge navigation after the moves.

## Consequences

Canonicalization, governed work, general orchestration, and improvement observation have separate bounded navigation paths. ADR numbers and content authority remain stable; directories provide navigation and create no new execution or knowledge authority.

## Verification

- `lervo migrate knowledge` reports no pending document-layout move.
- `lervo knowledge lint` reports no decision-route or leaf-capacity error.
- Documentation checks reject stale links to former paths.

## References

- [Repository knowledge compilation](../../../../specs/repository-knowledge-compilation.md)
- [Repository decision taxonomy](../../../../../.lervo/knowledge/document-layout.yaml)
- [Product outcome convergence](../../../../roadmap/product-outcome-convergence.md)
