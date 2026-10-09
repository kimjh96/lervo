# ADR-0494: Recover missing document evidence before requesting owner input

Status: `proposed`
Decision date: 2026-10-08
Amends on acceptance: [ADR-0463](../documents/0463-refresh-stale-documents-with-evidence-bound-minimal-edits.md), [ADR-0464](../documents/0464-report-document-drift-and-historical-documents.md)
Related: [ADR-0493](0493-schedule-knowledge-maintenance-by-ready-work-and-safe-effects.md), [ADR-0495](0495-separate-fast-maintenance-status-from-expensive-verification.md)

## Context

The October 8 pre-delivery investigation found two installed WSL freshness candidates requesting owner input with zero evidence items, no hunks, and no apply command. Both explanations cited missing changed-path diff and excerpts. An open `waiting_authority` candidate owned its document indefinitely, blocking another candidate for that document.

The [investigation](../../../evidence/quality/knowledge-maintenance-recovery-and-speed-design.md) reproduced the cause in a temporary repository using the evidence builder captured at that snapshot. It requested `git cat-file blob HEAD:<path>` even for connected directory paths, which could not return file bytes. A small directory diff supplied zero citeable items; an oversized directory diff also lost all fallback excerpts. The same oversized change bound to a regular file supplied one item and 40 excerpt lines.

At that snapshot, the stage admitted up to three findings, prioritized safety, and stopped admission for open candidates or exhausted identical attempts. These useful backstops presented technical evidence failure as owner authority. A provider could also return `no_change_needed` and be marked `verified` without advancing the detector's verified revision. That candidate blocked reassessment of the same finding while its lint warning remained visible.

Later [implementation evidence](../../../evidence/quality/knowledge-maintenance-recovery-and-speed-implementation.md) records both legacy-empty candidates, `kfresh_73cd716ad064fc1cc4afbfdd` and `kfresh_a3aa09a4b35093561f3a1ec8`, as `superseded` without owner bookkeeping. This removed the mistaken indefinite owner holds but does not establish complete replacement evidence recovery, document currency, or a schema-5 assessment receipt. The installed recovery acceptance gate remains open.

## Decision proposal

### Represent files and directory changes explicitly

Resolve each connected path as a Git object at both bound revisions before selecting evidence. Files have blob identities; directories have tree identities. For directory changes, enumerate changed child paths with NUL-delimited Git output. Bind each selected regular file to its before/after blob hashes and parent tree hashes. Treat added, deleted, and renamed children explicitly.

Select children deterministically: exact document references and named symbols first, rename/replacement matches next, then relevant changed files. Retain directory membership evidence even when an individual file is absent. Never infer that a truncated directory is unchanged.

Limit each bundle to 128 examined child entries, 16 selected changed files, 16 KiB per diff, 64 KiB total evidence text, 40 excerpt lines per file, and three related canonical documents. Byte limits include every excerpt and related-document payload, not just diff text. Apply existing sensitive-source and unsafe-path rules before bundling. Rank related documents through the prepared retrieval contract; path grep does not prove canonical relevance.

Page oversized changes with a deterministic continuation cursor bound to both tree hashes. Prefer referenced regions; if coverage remains insufficient, resume another bounded evidence work item. Preserve tree/object witnesses and omitted counts. Truncation means incomplete coverage, never permission for unsupported claims.

### Validate evidence before spending provider budget

Before generation, actionable findings must have resolving evidence for their relevant change reasons. Acceptable broken-reference evidence includes deletion, exact rename, replacement, or an explicit historical-reference witness. Broad directory changes without enough relevant children schedule evidence recovery, not a model call.

Distinguish these outcomes:

| Outcome | Owner and next action |
| --- | --- |
| `evidence_incomplete` | Agent collects the next bounded page or narrower source evidence. |
| `evidence_unavailable` | Agent reports history, source, permission, or adapter failure with a retry dependency. |
| `semantic_ambiguity` | Agent prepares concrete unresolved alternatives and supporting evidence. |
| `verified_pending_authority` | Owner receives an exact patch, source hash, output hash, and apply command. |
| `verified_no_change` | Detector accepts a current assessment witness; repository bytes remain unchanged. |

Existing user-owned statement/policy and consequential cross-check requirements remain. Owner approval cannot replace missing evidence. Recovery must not invent or install a new principal mandate.

### Recover old candidates and distinguish attempts

Readers first classify legacy `needs_owner_input` candidates. Empty-evidence candidates with no proposed effect become eligible technical recovery work under the new evaluation contract. Preserve canonical events and store the predecessor reference; never silently mark them approved or erase an owner rejection.

Key technical attempts by `(findingDigest, evidenceContractHash, sourceTreeDigest, failureCode)`. Two recovery attempts without new evidence block that exact technical dependency, not unrelated documents. New Git history, changed sources, a repaired adapter, or a new evaluation contract may reopen it once. Known quota resets or capacity releases schedule a wake. Genuine owner rejection and revert holds retain their original authority.

Supersession checks document bytes, connected-path hashes, policy, and review contract. Changed dependencies invalidate prior assessment even if the document is unchanged. Recovery produces a new bound candidate; it never edits an old approval to fit new bytes.

### Make no-change verification settle the detector

Add an exact `DocumentFreshnessAssessmentV1` witness for `verified_no_change`, binding document hash, dependency object hashes, reference-resolution digest, evidence bundle hash, reviewer identity, verification contract hash, assessment revision, and outcome. Require deterministic reference checks and independent semantic verification when claims need it. Unsupported provider no-change responses are not freshness proofs.

The detector consumes a witness only while every bound input matches. A newer unrelated commit alone does not invalidate it; a changed dependency does. Missing, invalid, or legacy unverified witnesses leave warnings and coverage unknown. No-change settlement must not clear normalization byte mismatch, broken references, or unrelated knowledge projections.

## State, events, privacy, and failure meaning

Add a versioned evidence receipt with `documentHash`, `sourceTreeDigest`, `evidenceContractHash`, `status`, `selectedCount`, `omittedCount`, `coveredReasonDigests`, `nextCursor` or null, and `failureCode` or null. Cursor and selected path coordinates stay in private CAS. Receipts have no approval authority.

New closed codes distinguish these outcomes, all leaving source bytes unchanged:

- `freshness_evidence_incomplete`: collect more evidence.
- `freshness_evidence_unavailable`: retry on a dependency.
- `freshness_evidence_recovery_exhausted`: technical recovery is exhausted.
- `freshness_semantic_ambiguity`: a real unresolved choice remains.
- `freshness_assessment_changed`: the assessment is stale.

Extend compatible readers before writers for `document.freshness.evidence.recovered` and `document.freshness.assessment.recorded`. Both require `projectId`, `findingDigest`, `documentHash`, `evidenceContractHash`, `receiptHash`, `outcome`, and `occurredAt`. Recovery also requires `predecessorCandidateId` or null and `attempt`; assessment requires `dependencyDigest` and `verificationContractHash`. Events exclude paths, hunks, source bodies, provider output, and credentials.

Retain candidate/hold limits of 512 and terminal retention of 30 days. Keep one latest assessment per document, capped by the 4,096-document policy; prune removed sources. Bodies remain in CAS under its existing retention. Projections are replaceable, owner-only, and reconstructible from canonical evidence.

## Verification and delivery

Reproduce small and oversized directory changes, directory renames/deletions, missing objects, shallow history, unusual path bytes, secret exclusions, and bounded paging. Empty coverage must cause zero generation calls. File and directory control cases must bind real evidence, not merely set a nonzero count.

Recover the two installed evidence-empty candidates without an owner bookkeeping command. Genuine ambiguity must present exact alternatives. A valid owner-held patch must still require its exact authorized apply. Test source/dependency changes after review, process death during recovery, and absence of duplicate provider calls or applies.

A reviewed no-change assessment must remove only its corresponding stale finding; a later dependency edit must restore it. No warning may disappear because it was ignored, timed out, or relabeled historical. Installed acceptance and rollout sequence are in the [delivery plan](../../../roadmap/knowledge/maintenance-recovery-and-speed.md).

## First delivery boundary

The [implementation evidence](../../../evidence/quality/knowledge-maintenance-recovery-and-speed-implementation.md) records the implemented subset, verification, and installed reader deployment. Schema-5 writer activation completed for Lervo checkouts on Mac and WSL; other repositories retain their selected writer versions. Both legacy-empty candidates were superseded, but replacement recovery outcomes remain unproven. Neither activation nor supersession establishes a schema-5 assessment receipt or document currency.

Complete evidence recovery, fleet recovery, full protocol acceptance, and the seven-day latency proof remain pending in the [delivery plan](../../../roadmap/knowledge/maintenance-recovery-and-speed.md). Genuine owner-held patches and policy decisions retain their existing authority requirements.
