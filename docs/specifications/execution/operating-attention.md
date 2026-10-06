# Operating attention

Status: `active`

As of: 2026-10-05

## Purpose

Lervo projects repository items requiring action into one provider-neutral, read-only report: pending user authority, review work, and safe repository maintenance otherwise hidden across commands or encountered incidentally by an agent.

The projection is not a source of truth. It reads the current workstream, canonicalization candidate registry, and repository-knowledge lifecycle inspection. Their existing ownership and mutation contracts remain authoritative.

## Contract

- [Report contract](operating-attention/report-contract.md): items, coverage, privacy, and failure behavior.
- [Direct terminal context](operating-attention/direct-terminal-context.md): prompt preparation, budgets, and authority boundaries.

## Verification

Acceptance requires:

1. Deterministic projection tests covering authority ordering, terminal-state exclusion, stable digests, unavailable-source behavior, stale workstream items, and context byte caps.
2. Direct-terminal integration proving a newly created candidate appears on the next preparation.
3. Application command tests for the JSON result.
4. A packed external consumer that discovers protocol v2 and invokes the route without private workspace imports.

## References

- [ADR-0361](../../decisions/execution/applications/0361-project-operating-attention-without-new-authority.md)
- [ADR-0462](../../decisions/execution/applications/0462-own-workstream-bookkeeping-and-stale-attention.md)
- [ADR-0464](../../decisions/knowledge/documents/0464-report-document-drift-and-historical-documents.md)
- [ADR-0463](../../decisions/knowledge/documents/0463-refresh-stale-documents-with-evidence-bound-minimal-edits.md)
- [Product-host protocol](product-host-protocol.md)
- [Repository knowledge lifecycle convergence](../../specs/repository-knowledge-lifecycle-convergence.md)
- [Product outcome convergence](../../roadmap/product-outcome-convergence.md)
