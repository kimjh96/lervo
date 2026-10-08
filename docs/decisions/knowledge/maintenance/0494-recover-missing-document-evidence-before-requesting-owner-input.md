# ADR-0494: Recover missing document evidence before requesting owner input

Status: `proposed`
Decision date: 2026-10-08
Amends on acceptance: [ADR-0463](../documents/0463-refresh-stale-documents-with-evidence-bound-minimal-edits.md), [ADR-0464](../documents/0464-report-document-drift-and-historical-documents.md)
Related: [ADR-0493](0493-schedule-knowledge-maintenance-by-ready-work-and-safe-effects.md), [ADR-0495](0495-separate-fast-maintenance-status-from-expensive-verification.md)

## Context

At the October 8 pre-delivery investigation, two installed WSL freshness candidates requested owner input with zero evidence items, no hunks, and no apply command. Both explanations said changed-path diff and excerpts were missing. An open `waiting_authority` candidate owned its document indefinitely, preventing admission of another candidate for that document.

The [investigation](../../../evidence/quality/knowledge-maintenance-recovery-and-speed-design.md) reproduced the cause using the evidence builder captured at that snapshot in a temporary repository. The builder requested `git cat-file blob HEAD:<path>` even when a connected path was a directory. That could not return file bytes. A small directory diff supplied zero citeable items; an oversized directory diff also lost all fallback excerpts. The same oversized change bound to a regular file supplied one item and 40 excerpt lines.

At that snapshot, the stage admitted up to three findings, prioritized safety, and stopped admission for open candidates or exhausted identical attempts. Those backstops were useful, but technical evidence failure was presented as owner authority. A provider could also return `no_change_needed` and be marked `verified` without advancing the detector's verified revision. Such a candidate blocked repeated assessment of the same finding while its lint warning remained visible.

The later [implementation evidence](../../../evidence/quality/knowledge-maintenance-recovery-and-speed-implementation.md) records both exact legacy-empty candidates, `kfresh_73cd716ad064fc1cc4afbfdd` and `kfresh_a3aa09a4b35093561f3a1ec8`, as `superseded` without an owner bookkeeping action. This removed the mistaken indefinite owner holds. It does not establish complete replacement evidence recovery, document currency, or a schema-5 assessment receipt; the installed recovery acceptance gate remains open.

## Decision proposal

### Represent files and directory changes explicitly

Resolve each connected path as a Git object at both bound revisions before selecting evidence. A file has a blob identity; a directory has a tree identity. For directory changes, enumerate changed child paths with NUL-delimited Git output and bind each selected regular file to its before/after blob hashes and the parent tree hashes. Treat added, deleted, and renamed children explicitly.

Select children deterministically: exact document references and named symbols first, rename/replacement matches next, then relevant changed files. Keep directory membership evidence even when an individual file is absent. Never infer that a truncated directory is an unchanged directory.

Bound each bundle to 128 examined child entries, 16 selected changed files, 16 KiB per diff, 64 KiB of total evidence text, 40 excerpt lines per file, and three related canonical documents. A byte limit includes every excerpt and related-document payload, not only diff text. Existing sensitive-source and unsafe-path rules apply before bundling. Rank related documents through the prepared retrieval contract; path grep is not proof of canonical relevance.

Oversized changes are paged by a deterministic continuation cursor bound to both tree hashes. Prefer referenced regions, then resume another bounded evidence work item if coverage is insufficient. Preserve tree/object witnesses and omitted counts. Treat truncation as incomplete coverage, never permission to make unsupported claims.

### Validate evidence before spending provider budget

An actionable finding must have resolving evidence for its relevant change reasons before generation. For a broken reference, acceptable evidence includes deletion, exact rename, replacement, or an explicit historical-reference witness. A broad directory change without enough relevant children schedules evidence recovery, not a model call.

Separate outcomes:

| Outcome                      | Owner and next action                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `evidence_incomplete`        | Agent collects the next bounded page or narrower source evidence.                      |
| `evidence_unavailable`       | Agent reports history, source, permission, or adapter failure with a retry dependency. |
| `semantic_ambiguity`         | Agent prepares the concrete unresolved alternatives and supporting evidence.           |
| `verified_pending_authority` | Owner receives an exact patch, source hash, output hash, and apply command.            |
| `verified_no_change`         | Detector accepts a current assessment witness; no repository bytes change.             |

Existing user-owned statement/policy and consequential cross-check requirements remain. Owner approval cannot substitute for missing evidence. Do not invent or install a new principal mandate through recovery.

### Recover old candidates and distinguish attempts

Readers first classify legacy `needs_owner_input` candidates. Candidates with empty evidence and no proposed effect become eligible technical recovery work under the new evaluation contract. Preserve their canonical events and store the predecessor reference; do not silently mark them approved or erase an owner rejection.

Key technical attempts by `(findingDigest, evidenceContractHash, sourceTreeDigest, failureCode)`. Two recovery attempts with no new evidence block that exact technical dependency, not unrelated documents. New Git history, changed sources, a repaired adapter, or a new evaluation contract may reopen it once. A known quota reset or capacity release schedules a wake. Genuine owner rejection and revert holds retain their original authority.

Candidate supersession checks document bytes, connected-path hashes, policy, and review contract. An unchanged document with changed dependencies still invalidates its prior assessment. Recovery produces a new bound candidate; it never edits the old approval to fit new bytes.

### Make no-change verification settle the detector

Add an exact `DocumentFreshnessAssessmentV1` witness for `verified_no_change`. Bind document hash, dependency object hashes, reference-resolution digest, evidence bundle hash, reviewer identity, verification contract hash, assessment revision, and outcome. Require deterministic reference checks and independent semantic verification when claims need it. A provider's unsupported no-change response is not a freshness proof.

The detector consumes a witness only while every bound input matches. A newer unrelated commit alone does not invalidate it; a changed dependency does. Missing, invalid, or legacy unverified witnesses leave warnings and coverage unknown. No-change settlement must not clear normalization byte mismatch, broken references, or unrelated knowledge projections.

## State, events, privacy, and failure meaning

Add a versioned evidence receipt with `documentHash`, `sourceTreeDigest`, `evidenceContractHash`, `status`, `selectedCount`, `omittedCount`, `coveredReasonDigests`, `nextCursor` or null, and `failureCode` or null. Cursor and selected path coordinates stay in private CAS. A receipt has no approval authority.

New closed codes are `freshness_evidence_incomplete`, `freshness_evidence_unavailable`, `freshness_evidence_recovery_exhausted`, `freshness_semantic_ambiguity`, and `freshness_assessment_changed`. They distinguish collect-more, retry-on-dependency, exhausted technical recovery, a real unresolved choice, and stale assessment. All leave source bytes unchanged.

Extend compatible readers before writers for `document.freshness.evidence.recovered` and `document.freshness.assessment.recorded`. Both require `projectId`, `findingDigest`, `documentHash`, `evidenceContractHash`, `receiptHash`, `outcome`, and `occurredAt`; recovery additionally requires `predecessorCandidateId` or null and `attempt`, and assessment requires `dependencyDigest` and `verificationContractHash`. Events exclude paths, hunks, source bodies, provider output, and credentials.

Keep current candidate/hold limits of 512 and terminal retention of 30 days. Keep one latest assessment per document, capped by the 4,096-document policy; prune removed sources. Bodies remain in CAS with its existing retention. Projections are replaceable, owner-only, and reconstructible from canonical evidence.

## Verification and delivery

Reproduce small and oversized directory changes, directory renames/deletions, missing objects, shallow history, unusual path bytes, secret exclusions, and bounded paging. Empty coverage must cause zero generation calls. File and directory control cases must bind real evidence, not merely set a nonzero count.

Recover the two installed evidence-empty candidates without an owner bookkeeping command. A genuine ambiguous choice must present exact alternatives. A valid owner-held patch must still require its exact authorized apply. Test source/dependency changes after review, process death during recovery, and no duplicate provider calls or applies.

A reviewed no-change assessment must remove only its corresponding stale finding. A later dependency edit must restore that finding. No warning may disappear because it was ignored, timed out, or relabeled historical. Installed acceptance and the rollout sequence are in the [delivery plan](../../../roadmap/knowledge/maintenance-recovery-and-speed.md).

## First delivery boundary

The [implementation evidence](../../../evidence/quality/knowledge-maintenance-recovery-and-speed-implementation.md) records the implemented subset, verification, and installed reader deployment. Schema-5 writer activation completed for the Lervo checkouts on Mac and WSL; other repositories retain their selected writer versions. The two legacy-empty candidates were superseded, but their replacement recovery outcomes remain unproven. Neither activation nor supersession establishes a schema-5 assessment receipt or document currency. Complete evidence recovery, fleet recovery, full protocol acceptance, and the seven-day latency proof remain pending in the [delivery plan](../../../roadmap/knowledge/maintenance-recovery-and-speed.md). Genuine owner-held patches and policy decisions retain their existing authority requirements.
