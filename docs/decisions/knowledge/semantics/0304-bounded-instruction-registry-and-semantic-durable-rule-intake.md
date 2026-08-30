---
lervo:
  decision:
    taxonomy: decisions.default
    route: knowledge.semantics
---

# ADR-0304: Bounded instruction registry and semantic durable-rule intake

Status: `accepted`
Decision date: 2026-08-30

## Context

The repository instruction route block listed every canonical instruction and portable skill in `AGENTS.md`, while development-pattern promotion appended another per-pattern list. Both projections grew linearly, made provider entrypoints noisy, and caused unrelated branches to edit the same file. Agents also lacked a safe one-shot path for repository-wide user rules: leaving them in conversation lost them, while copying arbitrary prompt prose into AGENTS created noise and unbounded memory.

## Decision

### Fixed-size instruction bootstrap

`AGENTS.md` contains one schema-2 Lervo-managed bootstrap whose size is independent of the number of instructions, skills, and promoted patterns. Before changing bytes, it directs agents to resolve current workstream state and query the repository knowledge registry with the task purpose and target paths. Canonical instruction documents and portable skills remain independently addressable sources; generated publications and query indexes are rebuildable routing projections.

Layout migration replaces the schema-1 enumerated route block and removes the obsolete `development_pattern_routes` block. If only those exact Lervo-managed blocks change, upgrade applies the bounded replacement without user-byte approval and preserves all surrounding user content. Changes to reference rewriting or any other user-owned region require ordinary exact review. Replanning after apply must be current.

Development-pattern promotion creates or accepts only its responsibility-owned target. It no longer edits AGENTS or CLAUDE; both providers resolve promoted sources through the knowledge registry.

### One-shot semantic durable-rule intake

The current provider returns a typed `durableInstruction` assessment in the existing no-capability grounding response. It separates speech act, authority, duration, operation, scope, normalized title and statement, exceptions, risk, conflict, confidence, and bounded reason IDs. The deterministic parser rejects extra fields and inconsistent canonical claims. Neither proposals nor resulting plans contain prompt text, keyword tables, phrase aliases, or synonym mappings.

Automatic materialization requires every gate below:

- The request is an explicit user directive, not an example, quotation, hypothetical, complaint, question, report, or inferred preference.
- Duration is repository-wide; scope is an unambiguous repository or bounded path set; and the operation only adds low-risk behavior.
- The bounded catalog of existing canonical instructions is complete; conflict is `none`; confidence is `high`; overall grounding is ready; and no ambiguity exists.
- Execution is not an assignment worker lacking repository-wide write scope.

Replacement, removal, high-risk behavior, incomplete catalogs, possible conflicts, and uncertain classifications become pending. Current-task directives remain in the workstream. Non-rules are ignored. Repetition and provider agreement never create user authority.

An eligible rule becomes a deterministic, content-addressed Markdown source under `docs/instructions/generated/`. It includes stable semantic metadata but excludes prompts, timestamps, provider-run identifiers, request digests, and source snapshots. Request and resolver digests remain only in the local materialization event. Repeating the same typed rule is current; different bytes at the same target block. Each rule uses a separate file so independent branch additions do not recreate a shared generated-record conflict.

## Consequences

AGENTS size remains constant, and unrelated rule or skill additions no longer contend on one entrypoint. Existing repositories migrate without discarding user-owned prefaces or requiring approval for an exact managed-block-only upgrade. A direct explicit rule can survive the current conversation and a fresh agent without copying conversation prose.

Semantic classification still permits false positives. The strict conjunctive gate favors false negatives, records typed outcomes for inspection, isolates each automatic effect in a removable file, and sends uncertain cases to pending state. Human-authored instruction documents remain user-owned and are never automatically overwritten.

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
