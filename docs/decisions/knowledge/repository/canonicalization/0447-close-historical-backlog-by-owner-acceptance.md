# ADR-0447: Close historical backlog by owner acceptance

Status: `accepted`
Decision date: 2026-10-03
Amends: [ADR-0434](0434-converge-background-canonicalization-normalization-and-knowledge.md), [ADR-0445](0445-scope-baseline-assessment-to-observed-obligations.md), and [ADR-0446](0446-retain-integrated-dispositions-across-baseline-supersession.md)

## Context

The installed Mac repository recorded 45 change obligations from 2026-09-25 through 2026-10-03. None reached `current`:

- Inline review left 20 `pending_review` candidates without an assigned reviewer.
- 7 obligations exceeded review or path limits.
- From 2026-09-30, the worker deferred every change to baseline convergence, which never completed.

ADR-0433 had also removed synchronous terminal maintenance, so the deferred work accumulated.

After ADR-0446, the backlog still contained 593 reviewable sources. One 540-path terminal turn applied reviewed document normalization. That rewrote 269 canonical documents and 271 normalization records. Reassessing those documents was circular because independent normalization review had already accepted their bytes.

The stalled audit also caused harm. It created five overlapping descriptions of the same two CI workflows. Repeated obligations reassessed the workflow sources, and each assessment lacked its predecessor's output in context. The agents that authored the historical changes had already documented them under the repository change contract.

## Decision

- **Owner acceptance.** The owner may accept exact historical obligations in tracked `.lervo/knowledge/history-acceptance.json`:
  - The file binds `schemaVersion: 1`, the project ID, disposition `owner_accepted`, a decision time, a rationale, and exact event ID and hash pairs.
  - Historical obligation discovery excludes only matching pairs.
  - Acceptance claims no semantic coverage, so later changes to those paths receive ordinary assessment.
- **Baseline audit record.** The baseline records the decision's content hash as `historyAcceptanceHash` and binds it into the debt digest. A malformed file, or one bound to another project, fails closed with `knowledge_job_source_invalid`. An absent file accepts nothing.
- **Reviewed Lervo outputs.**
  - Integrated canonical drafts settle their exact bytes and reference their integration event.
  - Current reviewed normalization outputs settle their exact bytes and reference their normalization record ID. This applies only when the output path or hash differs from the record's source.
  - Manual edits after either effect return the bytes to assessment.
- **First acceptance.** On 2026-10-03, the owner accepted the 44 outstanding Mac historical obligations. The owner closed 11 historical `candidate` or `stale` canonicalization candidates through reviewed rejection with reviewer ID `owner-history-acceptance`. Six duplicate CI document files, covering five overlapping descriptions, were removed with their four normalization records. The [code quality and commit CI](../../../../foundation/code-quality-and-commit-ci.md) reference keeps that content.

## Failure and privacy

This decision adds no event type or failure code. The acceptance file contains only local event IDs and hashes, with no paths, source bytes, request text, or provider output. Each acceptance matches only events in the local event history.

## Verification

Focused tests must show the following:

- Only exact accepted pairs close obligations.
- A foreign, malformed, or non-`owner_accepted` decision fails closed.
- Reviewed rewrite outputs stop qualifying after manual edits.
- Integrated draft bytes stay out of later baselines until edited.

Installed verification must show zero historical debt, a small residual assessment scope, and eventual `current` settlement.
