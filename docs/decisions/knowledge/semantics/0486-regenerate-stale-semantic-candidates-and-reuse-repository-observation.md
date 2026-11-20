# ADR-0486: Regenerate stale semantic candidates and reuse repository observation

Status: `accepted`
Decision date: 2026-10-07
Amends: [ADR-0485](0485-reevaluate-settled-semantic-candidates-once-per-evaluation-contract.md)
Amended by: [ADR-0490](0490-regenerate-stale-semantic-candidates-before-the-pre-stage-check.md) (regeneration runs before the owner's pre-stage check)
Amended by: [ADR-0491](0491-never-pin-tool-generated-files-as-assets-and-memoize-the-role-registry.md) (tool-generated lockfile declarations and installed recovery acceptance)
Amended by: [ADR-0532](../maintenance/0532-continue-background-review-past-capacity-and-optional-context-failures.md) (optional context failures and private document diagnostics)
Amended by: [ADR-0597](../maintenance/0597-keep-idle-and-non-owner-residents-off-the-repository.md) (only the convergence owner observes the repository)

## Context

About 15 minutes after `main` `c711afe6` was deployed on 2026-10-06, the WSL owner host showed:

- **digimon:** `attention_required/review_context_stale` at `canonical_review`. Of 20 context documents bound by the waiting canonical batch, 19 were unchanged. The twentieth, `docs/knowledge/documentation.md`, was a rebuildable publication page rewritten by knowledge refresh at 16:34 UTC. The broad recommendation loop in `loadCanonicalReviewContext` was the only selection path without the publication-root exclusion. A stale review needing only fresh context was settled as attention rather than regenerated.
- **lervo CPU:** The resident continuously used about one core in 10-second samples over two minutes. Before restart, its Node service used 5 h 47 min of CPU over 4 h 6 min. Local Mac measurements for the lervo repository put currency inspection at about 18 s of CPU and lint at about 10 s. Cycle-scoped discovery depended on both repository fence and event head, so every stage and assignment event repeated the full scan, capture, normalization inspection, and currency inspection.
- **lervo repository changes:** `stale/source_bytes_changed` at 19:27:39 UTC followed a `HEAD` reset at 19:27:37 UTC during that day's upgrade. A second reset at 20:03:13 UTC followed the merge of the owner's knowledge-output PR #79. Both were real repository changes. The obligation was requeued at 20:00 UTC and reached `canonical_review`. Merged decision and specification documents raised normalization debt from 89 to 101; no defect was involved.
- **shiflo, original diagnosis:** `attention_required/knowledge_verification_failed` at `canonical_integration` was attributed to the repository. The `repository-opaque-assets` command (`node tools/assets/verify-canonical-assets.mjs`) in pinned suite `repository.asset-integrity` exited 1 with `Error: Asset hash changed: bun.lock`. The reviewed asset manifest pins `bun.lock` at `sha256:78541f46…`; the owner's PR #51 (`65a2b631`) changed the committed file to `sha256:b5894c20…`. The same check fails on the owner checkout, so Lervo must not bypass it.

ADR-0491 supersedes the shiflo diagnosis attributing the cause to the repository: pinning a declared package manager's tool-generated lockfile as a canonical asset is a Lervo design gap. The original failed-suite observation remains valid evidence; the amended contract does not require manual lockfile repinning.

## Decision

- Review context must never bind the publication root, a rebuildable projection, on any selection path.
- When a stage starts and finds stale bound review context, it regenerates the review instead of settling `review_context_stale`, provided no effect has started. `canonical_review` returns to `assessment`, clearing batch and approval. `normalization_review` returns to `normalization_generation`, clearing batch, review, and accepted candidate. Each obligation may regenerate at most three times. Further stale context, and every stale context at integration or apply, retains the existing failure.
- Cycle-scoped discovery separates repository observation from an event half. Repository observation includes scan, capture, normalization, currency, and candidates; it is reused while the repository fence and latest `knowledge.materialization.applied` event remain unchanged. The event half includes historical obligations, settled dispositions, and acceptance; it refreshes on every new event head. Materialization always invalidates observation because it can rewrite ignored generated state invisible to the fence.

## State, events, privacy, and failure meaning

No event, state, or failure code is added. `canonical_review` and `normalization_review` receipts may record `status: review_context_regenerated` and a regeneration count, bounded by stage data `reviewContextRegenerations`.

## Verification

Focused tests must show:

- A publication-root recommendation is never loaded as review context.
- A stale canonical batch returns to assessment; the fourth stale context still fails.
- An appended event changing no repository byte reuses repository observation.

Installed verification must show:

- `digimon` leaving `review_context_stale`.
- The lervo resident idling between due stages instead of holding a core.
- Under ADR-0491, `shiflo` leaving `knowledge_verification_failed` after its owner host performs the same-scope rebind without an owner command. Tool-ownership evidence must establish the lockfile's package-manager ownership. The rebind removes tool-generated declarations from inline `assetDispositions` and the manifest, updates `assetDispositionManifestHash` through ordinary plan/apply, and preserves every other declaration's exact content and order and every scope coordinate. Recovery requires passing pinned verification against the resulting captured revision; the failed suite is never bypassed.

### Superseded installed acceptance

ADR-0491 replaces this original requirement, retained only as history:

- `shiflo` remaining at `knowledge_verification_failed` until the owner reviews a new `bun.lock` asset disposition.

Manual lockfile repinning is no longer current acceptance. Under ADR-0491, tool-generated opaque files count as `toolGenerated` and require no asset declaration.

### Evidence limits

Installed criteria are requirements, not evidence of recovery. Neither this decision nor ADR-0491 establishes an installed passing run for shiflo.

The ADR-0490 amendment link is retained, but its document was unavailable in the exact context of this correction. Its ordering amendment has therefore not been independently verified here. This correction supplies no replacement ordering contract and does not claim verification of regeneration before the owner's pre-stage check.
