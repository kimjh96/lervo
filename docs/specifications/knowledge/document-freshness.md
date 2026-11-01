# Document freshness

Status: `wired`
As of: 2026-10-05

This contract implements [ADR-0463](../../decisions/knowledge/documents/0463-refresh-stale-documents-with-evidence-bound-minimal-edits.md): detection inputs, evidence, candidate verification, apply authority, surfaces, events, policy, and fixtures. Roadmap labels identify the wired parts.

- [Pipeline, detection, admission, and evidence](document-freshness/pipeline.md)
- [Candidate contract and verification](document-freshness/candidates.md)
- [Authority, operations, surfaces, and validation](document-freshness/operations.md)

## References

- [ADR-0557 Tier 0 cross-check in an independent no-capability session](../../decisions/knowledge/documents/freshness/0557-cross-check-freshness-candidates-in-an-independent-no-capability-session.md)
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

### Proposed recovery and scheduling amendments

The [October 8 investigation](../../evidence/quality/knowledge-maintenance-recovery-and-speed-design.md) reproduced directory evidence loss and observed evidence-empty owner waits. [ADR-0493](../../decisions/knowledge/maintenance/0493-schedule-knowledge-maintenance-by-ready-work-and-safe-effects.md), [ADR-0494](../../decisions/knowledge/maintenance/0494-recover-missing-document-evidence-before-requesting-owner-input.md), and [ADR-0495](../../decisions/knowledge/maintenance/0495-separate-fast-maintenance-status-from-expensive-verification.md) propose fair preparation, technical recovery, exact assessment settlement, and bounded observations. The [delivery plan](../../roadmap/knowledge/maintenance-recovery-and-speed.md) records unchecked runtime gates. These proposals do not change the wired authority or apply contract until accepted and implemented.

### Installed journey completion

This correction supersedes the `installed-proven` label on delivery item 7 of ADR-0463. The supported result is one local run on a copy of the Lervo repository with the fixture provider, as recorded in the [delivery sequence](../../roadmap/open-collaboration-platform/delivery-sequence.md). The [operations contract](document-freshness/operations.md) leaves a real-provider run and an evidence document under `docs/evidence/quality/` open. Installed proof remains pending; the local fixture run does not establish real-provider installed completion. Weekly metrics projection also remains open.

### Related-document evidence selection

ADR-0463 requires the top three related canonical documents from the ADR-0459 prepared retrieval snapshot. The [pipeline contract](document-freshness/pipeline.md) currently describes a narrower implementation: select at most three related documents, choosing `supersededBy` first when present, then Markdown documents mentioning a replacement path.

That selection rule does not establish prepared-snapshot ranking or canonical-document eligibility. It is an implementation limitation, not evidence that the ADR's retrieval requirement is fulfilled. The prepared-snapshot requirement remains the intended contract. Completion requires integrating that selection and verifying its evidence bindings, or separately reviewing an amendment to the requirement. The existing path-and-hash bindings and evidence bounds remain applicable; they do not prove selection equivalence.

## Recovery and assessment implementation

The first [maintenance recovery delivery](../../evidence/quality/knowledge-maintenance-recovery-and-speed-implementation.md) expands changed Git trees into bounded regular-file evidence and prevents provider generation when coverage is empty, unavailable, or incomplete. An evidence-empty `needs_owner_input` candidate with no hunks, archive, output, approval, or rejection becomes `superseded` with `candidate_invalid`; genuine owner-held patches and owner rejections retain their authority.

A generated `no_change_needed` proposal requires a separate no-capability review and exact document, dependency, reference, policy, evidence, and verification bindings before detector settlement. The receipt is canonical in CAS plus a `document.freshness.assessment.recorded` event. The private bounded projection is validated against both; missing or corrupt proof leaves the finding visible. Dirty referenced sources invalidate reuse, and managed-input or other unrelated staleness reasons are not suppressed. A document with unresolved references never accepts `no_change_needed`; the generation instruction says so and requires editing each listed reference, or appending ` (removed)` to a line that records a past fact about a removed target.

Event schema 5 adds `document.freshness.evidence.recovered` and `document.freshness.assessment.recorded`. Both require project, finding, document, evidence-contract, receipt hashes and a timestamp. Recovery additionally records predecessor candidate, bounded attempt, and `ready | incomplete | unavailable | exhausted`; assessment records dependency and verification-contract hashes and `verified_no_change | changed | unavailable`. Payloads contain no document path or text. Existing writer selection remains unchanged until the exact configured reader inventory supports the complete history through version 5.

`freshness_evidence_unavailable` means evidence could not be observed safely; `freshness_evidence_incomplete` means bounded coverage is insufficient; `freshness_evidence_recovery_exhausted` means the same bounded recovery has stopped without requesting owner approval. These are technical recovery reasons exposed by freshness status. `freshness_assessment_reader_transition_required` means no schema-5 receipt can be written yet; it does not authorize a new writer or establish currency.
