# Document freshness

Status: `wired`
As of: 2026-10-05

This contract implements [ADR-0463](../../decisions/knowledge/documents/0463-refresh-stale-documents-with-evidence-bound-minimal-edits.md): detection inputs, evidence, candidate verification, apply authority, surfaces, events, policy, and fixtures. Roadmap labels identify the wired parts.

- [Pipeline, detection, admission, and evidence](document-freshness/pipeline.md)
- [Candidate contract and verification](document-freshness/candidates.md)
- [Authority, operations, surfaces, and validation](document-freshness/operations.md)

## References

- [ADR-0023 evidence-based document staleness](../../decisions/knowledge/documents/0023-evidence-based-document-staleness.md)
- [ADR-0464 document drift and historical documents](../../decisions/knowledge/documents/0464-report-document-drift-and-historical-documents.md)
- [ADR-0465 settled knowledge batch-boundary commits](../../decisions/knowledge/documents/0465-commit-settled-knowledge-documents-at-batch-boundaries.md)
- [ADR-0462 workstream bookkeeping and stale attention](../../decisions/execution/applications/0462-own-workstream-bookkeeping-and-stale-attention.md)
- [ADR-0022 byte-preserving managed-block patch candidates](../../decisions/knowledge/documents/0022-byte-preserving-managed-block-patch-candidate.md)
- [ADR-0206 public README preservation](../../decisions/knowledge/documents/0206-public-readme-preservation-and-improvement.md)
- [Background knowledge convergence runtime](../../specs/background-knowledge-convergence/runtime.md)
- [Operating attention](../execution/operating-attention.md)
- [Open collaboration platform roadmap](../../roadmap/open-collaboration-platform.md)

## Corrections and implementation limits

### Installed journey completion

This correction supersedes the `installed-proven` label on delivery item 7 of ADR-0463. The supported result is one local run on a copy of the Lervo repository with the fixture provider, as recorded in the [delivery sequence](../../roadmap/open-collaboration-platform/delivery-sequence.md). The [operations contract](document-freshness/operations.md) leaves a real-provider run and an evidence document under `docs/evidence/quality/` open. Installed proof remains pending; the local fixture run does not establish real-provider installed completion. Weekly metrics projection also remains open.

### Related-document evidence selection

ADR-0463 requires the top three related canonical documents from the ADR-0459 prepared retrieval snapshot. The [pipeline contract](document-freshness/pipeline.md) currently describes a narrower implementation: select at most three related documents, choosing `supersededBy` first when present, then Markdown documents mentioning a replacement path.

That selection rule does not establish prepared-snapshot ranking or canonical-document eligibility. It is an implementation limitation, not evidence that the ADR's retrieval requirement is fulfilled. The prepared-snapshot requirement remains the intended contract. Completion requires integrating that selection and verifying its evidence bindings, or separately reviewing an amendment to the requirement. The existing path-and-hash bindings and evidence bounds remain applicable; they do not prove selection equivalence.
