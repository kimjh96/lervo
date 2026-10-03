# ADR-0446: Retain integrated dispositions across baseline supersession

Status: `accepted`
Decision date: 2026-10-03
Amends: [ADR-0434](0434-converge-background-canonicalization-normalization-and-knowledge.md) and [ADR-0445](0445-scope-baseline-assessment-to-observed-obligations.md)

## Context

From 2026-09-30 to 2026-10-03, the installed Mac owner recorded 83 consecutive baseline obligations. Every obligation ended `superseded` with `source_bytes_changed`; none reached `current`. Across those obligations, 119 canonical batches settled integration, and independent review approved 599 source decisions. Those decisions covered only 76 distinct source paths and hashes, so later obligations repeated most provider work.

Each obligation fenced the complete repository snapshot through roughly 80 sequential eight-source batches. The repository received about 18 commits each day, including fixes to convergence itself, so commits superseded obligations faster than batches could finish. Prior batch reuse required equal contiguous worksets, equal canonical context bytes, and an equal delegation hash. Any earlier source change shifted later worksets, any documentation edit changed context, and delegation renewal invalidated every approval. Historical obligations clear only after full `current` settlement, so this debt kept growing.

## Decision

- An independently approved canonical decision with settled integration becomes a durable disposition for its exact source path and content hash. It survives supersession of the producing obligation.
- Baseline discovery removes exact settled source bytes from `assessmentPaths` and records each removed path, hash, and integration event ID in private `settledAssessments`. The debt digest binds this list.
- A settled disposition must bind the same project and knowledge policy. It must come from a `current` canonical integration whose approval matches the assessment hash, source hashes, and draft hashes. Its reviewer must differ from its generator. `needs_review`, rejected, and unintegrated decisions never settle.
- A `covered` disposition stays settled only if each quoted passage still exists in current bytes of its referenced canonical document. Unrelated edits elsewhere preserve it. Removing the quote returns the source to assessment.
- Delegation renewal does not invalidate settled dispositions. The disposition records a reviewed fact about exact source bytes. Delegation still governs new provider work and writes.
- The ledger replaces positional batch reuse. Changed bytes, a removed quote, or missing private evidence return the source to fresh assessment.
- The snapshot fence, independent review, normalization, lifecycle verification, and full-currency requirements remain unchanged. Supersession now loses only unfinished batches.

## Failure and privacy

This decision adds no event type, failure code, or public payload field. Settled paths, hashes, and quotes remain in private CAS state. Missing or invalid evidence fails toward fresh assessment, never toward coverage.

## Verification

Focused tests must show that the ledger:

- Keeps integrated dispositions after an unrelated edit supersedes a baseline.
- Reaches `baselineCurrent` without assessing any source path and hash twice.
- Returns changed source bytes to assessment.
- Keeps coverage after unrelated canonical edits and drops it once the quoted passage is removed or the policy changes.

Installed verification must show successor baselines with nonempty `settledAssessments`, a shrinking `assessmentPaths` count across supersessions, and eventual `current` settlement.
