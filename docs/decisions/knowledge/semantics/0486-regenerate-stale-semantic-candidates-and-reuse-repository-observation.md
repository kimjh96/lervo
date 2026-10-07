# ADR-0486: Regenerate stale semantic candidates and reuse repository observation

Status: `accepted`
Decision date: 2026-10-07
Amends: [ADR-0485](0485-reevaluate-settled-semantic-candidates-once-per-evaluation-contract.md)
Amended by: [ADR-0490](0490-regenerate-stale-semantic-candidates-before-the-pre-stage-check.md) (regeneration runs before the owner's pre-stage check)

## Context

About 15 minutes after `main` `c711afe6` was deployed on 2026-10-06, the WSL owner host showed the following.

- **digimon** recorded `attention_required/review_context_stale` at `canonical_review`. The waiting canonical batch had bound 20 context documents. Nineteen of them were unchanged. The twentieth was `docs/knowledge/documentation.md`, a rebuildable publication page that the knowledge refresh rewrote at 16:34 UTC. The broad recommendation loop of `loadCanonicalReviewContext` was the only selection path without the publication-root exclusion. A stale review that needs only fresh context was settled as attention, not regenerated.
- **lervo**'s resident used about one core continuously in 10-second samples over two minutes, and its Node service used 5 h 47 min of CPU over 4 h 6 min before the restart. On the lervo repository, one currency inspection costs about 18 s of CPU and one lint about 10 s, measured locally on a Mac. Cycle-scoped discovery was keyed on the repository fence and the event head. Every stage and assignment event therefore repeated the complete scan, capture, normalization inspection, and currency inspection.
- **lervo**'s `stale/source_bytes_changed` at 19:27:39 UTC followed a `HEAD` reset at 19:27:37 UTC from that day's upgrade. A second reset at 20:03:13 UTC followed the merge of the owner's knowledge-output PR #79. Both are real repository changes. The obligation was requeued at 20:00 UTC and reached `canonical_review`. The normalization debt rose from 89 to 101 because those merges added decision and specification documents. No defect is involved.
- **shiflo** recorded `attention_required/knowledge_verification_failed` at `canonical_integration`, and the cause is the repository itself. The command `repository-opaque-assets` (`node tools/assets/verify-canonical-assets.mjs`) of its pinned suite `repository.asset-integrity` exited 1 with `Error: Asset hash changed: bun.lock`. The reviewed asset manifest pins `bun.lock` at `sha256:78541f46…`. The owner's PR #51 (`65a2b631`) changed the committed `bun.lock` to `sha256:b5894c20…`. The same check fails on the owner checkout, so Lervo must not bypass it.

## Decision

- Review context never binds the publication root, which is a rebuildable projection, on any selection path.
- When a stage starts and finds a review's bound context stale, it regenerates that review instead of settling `review_context_stale`, provided no effect has started. `canonical_review` returns to `assessment` with the batch and approval cleared. `normalization_review` returns to `normalization_generation` with the batch, review, and accepted candidate cleared. Each obligation regenerates at most three times. A further stale context, and every stale context at integration or apply, keeps the existing failure.
- Cycle-scoped discovery splits into a repository observation and an event half. The repository observation is the scan, capture, normalization, currency, and candidates. It is reused while the repository fence and the latest `knowledge.materialization.applied` event are unchanged. The event half covers historical obligations, settled dispositions, and acceptance, and it refreshes on every new event head. A materialization always invalidates the observation, because it can rewrite ignored generated state that the fence cannot see.

## State, events, privacy, and failure meaning

No event, state, or failure code is added. The `canonical_review` and `normalization_review` receipts may record `status: review_context_regenerated` and a regeneration count. The stage data `reviewContextRegenerations` bounds them.

## Verification

Focused tests must show:

- A publication-root recommendation is never loaded as review context.
- A stale canonical batch returns to assessment, and the fourth stale context still fails.
- An appended event that changes no repository byte reuses the repository observation.

Installed verification must show:

- `digimon` leaving `review_context_stale`.
- The lervo resident idling between due stages, instead of holding a core.
- `shiflo` remaining at `knowledge_verification_failed` until the owner reviews a new `bun.lock` asset disposition.
