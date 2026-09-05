---
lervo:
  decision:
    taxonomy: decisions.default
    route: knowledge.semantics
---

# ADR-0304: Bounded instruction registry and semantic durable-rule intake

Status: `accepted`
Decision date: 2026-08-30

ADR-0376 supersedes the automatic direct-hook materialization below with explicit candidate intake and exact review. The semantic gates and deterministic generated-document contract remain authoritative.

## Context

`AGENTS.md` listed every canonical instruction and portable skill, while development-pattern promotion added a per-pattern list. Both projections grew linearly, cluttered provider entrypoints, and caused unrelated branches to edit the same file. Repository-wide user rules also lacked a safe one-shot intake: conversation-only rules were lost, while copying arbitrary prompt prose into AGENTS created noise and unbounded memory.

## Decision

### Fixed-size instruction bootstrap

`AGENTS.md` contains one schema-2 Lervo-managed bootstrap, independent in size of instruction, skill, and promoted-pattern counts. Before changing bytes, it directs agents to resolve current workstream state and query the repository knowledge registry using task purpose and target paths. Canonical instruction documents and portable skills remain independently addressable sources; generated publications and query indexes are rebuildable routing projections.

Layout migration replaces the schema-1 enumerated route block and removes `development_pattern_routes`. When only those exact Lervo-managed blocks change, upgrade applies the bounded replacement without user-byte approval and preserves surrounding user content. Reference rewriting and changes to any other user-owned region require ordinary exact review. Replanning after apply must be current.

Development-pattern promotion creates or accepts only its responsibility-owned target. It no longer edits AGENTS or CLAUDE; both providers resolve promoted sources through the knowledge registry.

### One-shot semantic durable-rule intake

The current provider returns a typed `durableInstruction` assessment in the existing no-capability grounding response. It separates speech act, authority, duration, operation, scope, normalized title and statement, exceptions, risk, conflict, confidence, and bounded reason IDs. The deterministic parser rejects extra fields and inconsistent canonical claims. Proposals and resulting plans contain no prompt text, keyword tables, phrase aliases, or synonym mappings.

Automatic materialization requires every gate:

- An explicit user directive, not an example, quotation, hypothetical, complaint, question, report, or inferred preference.
- Repository-wide duration, unambiguous repository or bounded-path scope, and an operation that only adds low-risk behavior.
- A complete bounded catalog of existing canonical instructions, conflict `none`, confidence `high`, ready overall grounding, and no ambiguity.
- Execution is not an assignment worker lacking repository-wide write scope.

Replacement, removal, high-risk behavior, incomplete catalogs, possible conflicts, and uncertain classifications become pending. Current-task directives remain in the workstream; non-rules are ignored. Repetition and provider agreement never create user authority.

An eligible rule becomes a deterministic, content-addressed Markdown source under `docs/instructions/generated/`. It includes stable semantic metadata and excludes prompts, timestamps, provider-run identifiers, request digests, and source snapshots. Request and resolver digests remain only in the local materialization event. Repeating the same typed rule is current; different bytes at the same target block. Each rule occupies a separate file so independent branch additions avoid shared generated-record conflicts.

## Consequences

AGENTS size remains constant, and unrelated rule or skill additions no longer contend on one entrypoint. Exact managed-block-only upgrades preserve user-owned prefaces without approval. A direct explicit rule can survive the conversation and a fresh agent without copying conversation prose.

Semantic classification can still produce false positives. The strict conjunctive gate favors false negatives, records typed outcomes for inspection, isolates each automatic effect in a removable file, and sends uncertain cases to pending. Human-authored instruction documents remain user-owned and are never automatically overwritten.

## Verification

- Five hundred instructions and five hundred skills render the same sub-4-KiB AGENTS bootstrap as an empty registry.
- Schema-1 route and development-pattern blocks migrate to schema 2, preserve surrounding user bytes, and immediately replan current.
- Repository upgrade applies the managed-only migration and does not rewrite AGENTS on the next inspection.
- A typed explicit repository directive creates one deterministic instruction and repeats as current without retaining prompt text.
- A fresh provider session retrieves that instruction for a matching task and omits substantially weaker incidental matches without a keyword map.
- Example-shaped, ambiguous, conflicting, risky, replacement, removal, worker-scoped, and incomplete-catalog assessments cannot materialize.
- Grounding parsers reject raw prompt and keyword fields.

## References

- [Repository knowledge compilation](../../../specs/repository-knowledge-compilation.md)
- [Repository knowledge lifecycle convergence](../../../specs/repository-knowledge-lifecycle-convergence.md)
- [Typed semantic request grounding](../../../specifications/execution/semantic-grounding.md)
