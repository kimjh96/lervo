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
