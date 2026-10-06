# ADR-0479: Park rejected semantic candidates and settle opaque assets by the delegation suite

Status: `accepted`
Decision date: 2026-10-06
Amended by: [ADR-0480](0480-bind-generated-projections-by-hash-in-lifecycle-plan-review.md) (generated projections bound by hash in lifecycle plan review)
Amends: [ADR-0435](../repository/canonicalization/0435-continue-normalization-after-canonical-rejection.md), [ADR-0438](../repository/canonicalization/0438-bind-bounded-asset-manifests-to-delegation.md), and [ADR-0448](../repository/canonicalization/0448-settle-unread-sensitive-sources-by-disposition.md)

## Context

On 2026-10-06 the WSL owner host showed background convergence stopped in `attention_required` in five repositories. Each stop came from one item, and each held back every other stage of its obligation.

- `lervo` and `flemo` stopped at `normalization_generation` with `knowledge_semantic_review_rejected`. The reviewer rejected five `lervo` documents because split indexes dropped anchors that other documents link to, such as `cross-host-ownership.md#publication`. It rejected `flemo`'s `AGENTS.md` because the rewrite paraphrased a managed region. Generation filtered each rejected document by content hash, so a rejected document was never generated again. Once every pending document had been rejected, the whole obligation stopped. Lifecycle verification never ran, and each new obligation repeated the same rejections.
- `digimon` stopped at `canonical_review`. After the one existing feedback re-assessment, the reviewer rejected the whole workset because `README.md` stayed `needs_review` and named a roster conflict and an asset-lifecycle discrepancy. That part needs the owner. The other sources in the workset and every later workset were never assessed.
- `axli` stopped at `assessment` with `knowledge_source_limit_exceeded`. The private failure evidence came from `reviewLifecyclePlan`. That review disclosed the plan's paths plus the full text of every assessment source. In `axli` this meant 273 text sources and 1,961,068 bytes, mostly uncommitted code under `services/worker` (1.22 MB), `pnpm-lock.yaml`, `uv.lock`, and STEP model data. Opaque bytes were already excluded. The request bound is 1 MiB, so every layout plan failed whatever its size.
- `plen` stopped at `lifecycle_verification` with `asset_verification_required`. 58 tracked PNG files, including app icons and app-store captures, had no `opaque_verified` declaration. The seeded delegation pins one suite, `repository.knowledge`, and declares no assets. Seeding never declares assets, so every repository with tracked images would stop the same way.

The owner wants background maintenance to keep working without supervision. Authority is checked at consequential effects, not at status claims.

## Decision

### Bounded regeneration and parking

- Normalization review records, for each rejected document, its content hash, its attempt count, and up to four reasons. Each reason is the reviewer's rationale plus the names of failed checks, at most 1,024 characters.
- Generation first takes documents never rejected at their current bytes. It then regenerates a rejected document alone, carrying `independentReviewFeedback: { attempt, reasons }` in its envelope. The normalizer instruction then requires every listed reason to be resolved while still following every rule. The feedback changes the shard-cache identity, so a regeneration can never replay the rejected response. Each attempt has its own batch identity and provider-call budget.
- A document is generated at most three times for one content hash. After that, it is parked as `review_rejected`, and generation continues with the remaining documents. When no document remains, generation completes with no batch, so review, apply, and lifecycle verification still run.
- A rejected canonical workset keeps the one existing re-assessment with the reviewer's rationale. If the workset is rejected again, it is halved at the same cursor, and each half gets its own re-assessment. A single rejected source is parked, and the cursor moves past it. A single source that its generator marked `needs_review` is parked at once as `owner_decision`. Accepted halves are integrated as before. Rejection no longer hands the remaining canonical worksets off to normalization; ADR-0435's handoff is replaced.
- Parked sources live in the obligation's stage data. They are carried to later obligations through the latest `knowledge_sources_parked` dependency, but only while their bytes are unchanged. Editing a parked source is the recovery, and nothing else is needed. Later worksets skip carried sources whose bytes are unchanged, so these sources make no further provider calls.
- Lifecycle verification excludes parked canonical sources from the required coverage. It treats pending normalization as parked only when every pending document is parked. It applies all other lifecycle work. If every remaining condition is satisfied and parked sources remain, it records `attention_required/knowledge_sources_parked`. A parked source is never counted as covered, and the obligation never claims baseline currency.

### Plan-scoped lifecycle review

The exact lifecycle plan reviewer sees only the paths the plan changes and their review context. Unchanged sources cannot gain or lose meaning through a plan, and link rewrites caused by a move are themselves plan paths. The 1 MiB request bound remains and now grows with the plan, not with the repository. Generated, binary, data, and vendored files need no separate classification for this review, because unchanged files are never sent.

### Suite-bound opaque assets

At final verification, each nonsensitive opaque source not excluded by policy is either declared, meaning a reviewed `opaque_verified` disposition matches its exact path and hash, or suite-bound. A suite-bound asset is settled because its exact bytes belong to the captured revision on which every pinned delegation suite passed. A delegation always pins at least one suite. A failing suite still stops verification with `knowledge_verification_failed`. The lifecycle proof records `assetSettlement: { declared, suiteBound, suiteBoundHash, suiteBoundArtifactHash }`. The private artifact lists each suite-bound path and hash with the suite receipts. Suite binding establishes no visual quality, runtime promotion, or semantic coverage. Declared dispositions keep their meaning, and owners may still add them.

### Upgrade

Pre-ADR stops with dependency kind `normalization_rejection`, `canonical_rejection`, or `typed_asset_verification` are no longer current. The owner requeues each stage once, and the stage proceeds under the rules above. A retained canonical rejection is reused without another review call. A stage failure now carries `evaluationContract: "adr-0479"`. An older `knowledge_source_limit_exceeded` stage failure without that field is reevaluated once. A repeated limit stays settled and does not loop.

## State, events, privacy, and failure meaning

No event type or state is added. One failure code is added:

| Code                       | State                | Meaning                                                                                                             | Recovery                                                                                                                                                                 |
| -------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `knowledge_sources_parked` | `attention_required` | Every other source, stage, and projection finished; only parked sources keep the obligation from baseline currency. | Edit each parked source, or resolve its `owner_decision`. Changed bytes readmit it automatically. Unchanged bytes stay parked across obligations without provider calls. |

The private `parked_sources` dependency binds the snapshot hash, the delegation hash, and each source's stage, path, content hash, reason, attempt count, and bounded reviewer reasons. Owner status for this reason adds `parked: { count, sources: [{ stage, path, reason, attempts }] }`, which never includes reviewer text or document bytes. Public events carry only the code.

`knowledge_semantic_review_rejected` remains for a rejected lifecycle plan and a deferred candidate resolution. `asset_verification_required` is no longer produced by lifecycle verification, and it keeps its change-intake meaning.

## Verification

Focused tests must show:

- A rejected document is regenerated with the reviewer's reasons and converges.
- An always-rejected document is parked after three generations. The rest is applied, and its status names the document. A new obligation makes no further call for unchanged bytes, and an edit readmits it.
- A rejected canonical workset is halved until only the offending source is parked. The other sources are integrated, and a legacy whole-pipeline stop resumes once.
- A lifecycle plan review is limited to the plan's paths despite more than 1 MiB of unrelated text.
- An undeclared opaque asset reaches verified currency as suite-bound, with private evidence.
- Pure tests cover admission, workset skipping, the reading of pre-ADR records, and the one-time reevaluation rule.

Installed verification must show `lervo`, `flemo`, `digimon`, `axli`, and `plen` leaving their 2026-10-06 stops. Each repository must reach verified currency or a precise `knowledge_sources_parked`.

## References

- [Canonical rejection](../../../specs/background-knowledge-convergence/runtime/discovery-and-progress/discovery-and-stages/rejection-and-integration/canonical-rejection.md)
- [Asset verification](../../../specs/background-knowledge-convergence/authority-and-completion/authority-and-integration/source-and-assessment/assets.md)
- [States and status inspection](../../../specs/background-knowledge-convergence/runtime/events-and-status/status-and-inspection.md)
- [Installed concurrency acceptance](../../../roadmap/knowledge/autonomous-background-convergence/acceptance/installed-concurrency.md)
