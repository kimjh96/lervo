# ADR-0479: Park rejected semantic candidates and settle opaque assets by the delegation suite

Status: `accepted`
Decision date: 2026-10-06
Amends: [ADR-0435](../repository/canonicalization/0435-continue-normalization-after-canonical-rejection.md), [ADR-0438](../repository/canonicalization/0438-bind-bounded-asset-manifests-to-delegation.md), and [ADR-0448](../repository/canonicalization/0448-settle-unread-sensitive-sources-by-disposition.md)
Amended by:

- [ADR-0481](0481-bind-generated-projections-by-hash-in-lifecycle-plan-review.md): generated projections bound by hash in lifecycle plan review.
- [ADR-0485](0485-reevaluate-settled-semantic-candidates-once-per-evaluation-contract.md): lifecycle plans park; every settled stall is reevaluated once per contract.
- [ADR-0491](0491-never-pin-tool-generated-files-as-assets-and-memoize-the-role-registry.md): tool-generated opaque files are not canonical assets.
- [ADR-0530](../maintenance/0530-keep-background-knowledge-moving-past-divergent-targets.md): sources whose approved drafts meet divergent integration targets park as `target_diverged`.

## Context

On 2026-10-06, background convergence on the WSL owner host stopped in `attention_required` in five repositories. In each, one item blocked every other stage of its obligation:

- `lervo` and `flemo` stopped at `normalization_generation` with `knowledge_semantic_review_rejected`. Five `lervo` documents were rejected because split indexes dropped linked anchors, including `cross-host-ownership.md#publication`. `flemo`'s `AGENTS.md` was rejected because its rewrite paraphrased a managed region. Generation excluded rejected documents by content hash, preventing regeneration. Once all pending documents were rejected, the obligation stopped without lifecycle verification. New obligations repeated the rejections.
- `digimon` stopped at `canonical_review`. After the existing single feedback re-assessment, the reviewer rejected the whole workset because `README.md` remained `needs_review`, citing a roster conflict and an asset-lifecycle discrepancy requiring the owner. Other sources in that workset and all later worksets remained unassessed.
- `axli` stopped at `assessment` with `knowledge_source_limit_exceeded`. Private evidence identified `reviewLifecyclePlan`, which disclosed plan paths and every assessment source's full text: 273 text sources totaling 1,961,068 bytes, mostly uncommitted code under `services/worker` (1.22 MB), `pnpm-lock.yaml`, `uv.lock`, and STEP model data. Opaque bytes were already excluded. The 1 MiB request bound made every layout plan fail regardless of plan size.
- `plen` stopped at `lifecycle_verification` with `asset_verification_required`: 58 tracked PNG files, including app icons and app-store captures, lacked `opaque_verified` declarations. Seeded delegation pins the `repository.knowledge` suite and declares no assets. Seeding never declares assets, so every repository with tracked images would encounter the same stop.

The owner wants unattended background maintenance. Authority is checked at consequential effects, not status claims.

## Decision

### Bounded regeneration and parking

- For each rejected document, normalization review records its content hash, attempt count, and up to four reasons. Each reason contains the reviewer's rationale and failed-check names, limited to 1,024 characters.
- Generation first selects documents never rejected at their current bytes. It then regenerates each rejected document alone with `independentReviewFeedback: { attempt, reasons }` in its envelope. The normalizer must resolve every listed reason while following every rule. Feedback changes the shard-cache identity, preventing replay of a rejected response. Each attempt has its own batch identity and provider-call budget.
- A document receives at most three generations per content hash, then is parked as `review_rejected`. Generation continues with remaining documents. When none remain, generation completes with no batch so review, apply, and lifecycle verification still run.
- A rejected canonical workset retains the existing single re-assessment with reviewer rationale. If rejected again, it is halved at the same cursor; each half receives its own re-assessment. A single rejected source is parked and the cursor advances. A single source marked `needs_review` by its generator is parked immediately as `owner_decision`. Accepted halves are integrated as before. This replaces ADR-0435's handoff of remaining canonical worksets to normalization.
- Parked sources reside in the obligation's stage data and carry into later obligations through the latest `knowledge_sources_parked` dependency only while their bytes remain unchanged. Editing a parked source is sufficient recovery. Later worksets skip unchanged carried sources without further provider calls.
- Lifecycle verification excludes parked canonical sources from required coverage and treats pending normalization as parked only when every pending document is parked. It applies all other lifecycle work. If all other conditions are satisfied and parked sources remain, it records `attention_required/knowledge_sources_parked`. Parked sources never count as covered, and the obligation never claims baseline currency.

### Plan-scoped lifecycle review

The exact lifecycle plan reviewer receives only paths changed by the plan and their review context. Unchanged sources cannot gain or lose meaning through a plan; move-induced link rewrites are themselves plan paths. The 1 MiB request bound remains, but request size grows with the plan rather than the repository. Generated, binary, data, and vendored files need no separate classification for this review because unchanged files are never sent.

### Suite-bound opaque assets

At final verification, each nonsensitive opaque source not excluded by policy is either:

- Declared: a reviewed `opaque_verified` disposition matches its exact path and hash.
- Suite-bound: its exact bytes belong to the captured revision on which every pinned delegation suite passed.

A delegation always pins at least one suite. A failing suite still stops verification with `knowledge_verification_failed`. The lifecycle proof records `assetSettlement: { declared, suiteBound, suiteBoundHash, suiteBoundArtifactHash }`. A private artifact lists every suite-bound path and hash with suite receipts.

Suite binding establishes no visual quality, runtime promotion, or semantic coverage. Declared dispositions retain their meaning, and owners may still add them.

### Upgrade

Pre-ADR stops with dependency kind `normalization_rejection`, `canonical_rejection`, or `typed_asset_verification` are no longer current. The owner requeues each stage once to proceed under these rules. A retained canonical rejection is reused without another review call.

Stage failures now carry `evaluationContract: "adr-0479"`. An older `knowledge_source_limit_exceeded` stage failure without that field is reevaluated once. A repeated limit stays settled without looping.

## State, events, privacy, and failure meaning

No event type or state is added. One failure code is added:

| Code | State | Meaning | Recovery |
| --- | --- | --- | --- |
| `knowledge_sources_parked` | `attention_required` | Every other source, stage, and projection finished; only parked sources prevent baseline currency. | Edit each parked source or resolve its `owner_decision`. Changed bytes automatically readmit it. Unchanged bytes remain parked across obligations without provider calls. |

The private `parked_sources` dependency binds the snapshot hash, delegation hash, and each source's stage, path, content hash, reason, attempt count, and bounded reviewer reasons. Owner status for this reason adds `parked: { count, sources: [{ stage, path, reason, attempts }] }`, never reviewer text or document bytes. Public events carry only the code.

`knowledge_semantic_review_rejected` remains for rejected lifecycle plans and deferred candidate resolutions. Lifecycle verification no longer produces `asset_verification_required`; that code retains its change-intake meaning.

## Verification

Focused tests must show:

- A rejected document regenerates with reviewer reasons and converges.
- An always-rejected document parks after three generations; the rest is applied and status names the parked document. A new obligation makes no further call for unchanged bytes; an edit readmits it.
- A rejected canonical workset is halved until only the offending source is parked. Other sources are integrated, and a legacy whole-pipeline stop resumes once.
- Lifecycle plan review includes only plan paths despite more than 1 MiB of unrelated text.
- An undeclared opaque asset reaches verified currency as suite-bound, with private evidence.
- Pure tests cover admission, workset skipping, reading pre-ADR records, and one-time reevaluation.

Installed verification must show `lervo`, `flemo`, `digimon`, `axli`, and `plen` leaving their 2026-10-06 stops. Each must reach verified currency or a precise `knowledge_sources_parked`.

## References

- [Canonical rejection](../../../specs/background-knowledge-convergence/runtime/discovery-and-progress/discovery-and-stages/rejection-and-integration/canonical-rejection.md)
- [Asset verification](../../../specs/background-knowledge-convergence/authority-and-completion/authority-and-integration/source-and-assessment/assets.md)
- [States and status inspection](../../../specs/background-knowledge-convergence/runtime/events-and-status/status-and-inspection.md)
- [Installed concurrency acceptance](../../../roadmap/knowledge/autonomous-background-convergence/acceptance/installed-concurrency.md)
