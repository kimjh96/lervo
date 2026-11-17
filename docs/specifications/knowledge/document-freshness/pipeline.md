# Document freshness pipeline

## Pipeline

```text
ADR-0464 detection ─► finding mapping ─► prioritize ─► admit (budget) ─► bundle evidence
   ─► evidence preflight ─► governed generation ─► deterministic checks ─► Tier 0 cross-check ─► authority ─► apply ─► commit
                                  │                      │                    │                   │
                                  │                      └─► rejected         ├─► rejected        └─► waiting for the owner
                                  │                                           │   (disagreement)
                                  │                                           └─► verified_pending_cross_check (unavailable)
                                  └─► no_change_needed ─► independent review ─► exact assessment receipt
```

The knowledge resident owns the stage (`packages/repository-knowledge-runtime/src/freshness-stage.ts`), which follows per-change intake and convergence in `runAutonomousKnowledgeWorker`. Stage failure never blocks intake or convergence.

The first maintenance recovery delivery reserves a preparation turn after two convergence turns. Repository and host cycle locks remain around each bounded turn, and the parked-convergence effect gate remains: effects require convergence to be `idle`, `current`, `waiting_authority`, or `attention_required`. Queued convergence therefore does not exclude all freshness preparation. This initial counter does not establish the proposed eligible-provider-turn latency guarantee or concurrent provider execution. Releasing capture locks before provider calls and proving exclusive apply, journal recovery, checkpoint, and rebind remain open under [ADR-0493](../../../decisions/knowledge/maintenance/0493-schedule-knowledge-maintenance-by-ready-work-and-safe-effects.md).

A freshness commit moves HEAD like a developer commit. The retained effect gate prevents it from landing between an [ADR-0465](../../../decisions/knowledge/documents/0465-commit-settled-knowledge-documents-at-batch-boundaries.md) batch-boundary commit and the stage that commit re-queued under its `committedHead` fence. Documents with uncommitted settled outputs are never refreshed: their working bytes differ from HEAD. Owner operations also refuse while any live or interrupted materialization journal owns the repository. Preparation and review grant no authority to overwrite user-owned bytes; the [operations contract](operations.md#authority-and-apply) governs every apply.

Candidate state lives under `.lervo/state/knowledge/freshness-candidates/<2-hex shard>/kfresh_<24 hex>.json`, holds under `.lervo/state/knowledge/freshness-holds/`, and the cycle record in `.lervo/state/knowledge/freshness-cycle.json`. Bundles and before-bytes live in CAS. Candidate, hold, and cycle projections are rebuildable from events plus the repository and retained artifacts. Retention removes terminal candidates after 30 days and keeps at most 512 candidates and 512 holds. Assessment receipts are canonical CAS evidence with an event; their private projection is rebuildable and is not itself settlement proof.

The stage fence digests HEAD, working-tree status, policy, holds, and candidate states. An unchanged fence skips the stage without writing. A `generated` `no_change_needed` candidate reopens an unchanged fence only while today's budget covers one more candidate at `maximumTokensPerCandidate`; otherwise the stage would observe again and append an identical cycle event that wakes the resident ([ADR-0580](../../../decisions/knowledge/maintenance/0580-let-a-resident-with-parked-work-back-off.md)). The day in the fence reopens it with a new budget. A pass deferred before any provider call that generated, verified, and applied nothing, over unchanged findings, appends no `document.freshness.cycle.completed`; its stage key stays null, so the next cycle retries it. The ADR-0461 resident fingerprint includes the recorded `findingsDigest` and hold store; the candidate store is already observed as a `*-candidates` directory.

## Detection input

The loop reads one `DocumentFreshnessFindingV1` per document. `observeDocumentFreshnessFindings` in `@lervo/repository-knowledge` runs `lervo knowledge lint` in `evaluate_and_record` mode and reads `readRecordedDocumentStalenessReport` ([ADR-0464](../../../decisions/knowledge/documents/0464-report-document-drift-and-historical-documents.md)). It uses the report only when `currentRevision` equals HEAD. The pure `documentFreshnessFinding` function maps the report entry and detection-side enrichment; the freshness stage infers no field itself.

| Field | Type | Source |
| --- | --- | --- |
| `findingDigest` | sha256 of the canonical finding excluding `detectedAt` | mapping |
| `sources[]` | `document_stale`, `entrypoint_reference_missing`, `markdown_link_target_missing` | ADR-0464 report and drift lint codes |
| `documentPath` | repository-relative path | report or lint finding |
| `documentHash` | sha256 of current bytes | working tree |
| `verifiedRevision` | report's verified revision, or null for lint-only findings | ADR-0464 report |
| `currentRevision` | HEAD | Git |
| `reasons[]` | `connected_path_changed`, `connected_path_deleted`, `reference_target_missing`, `review_interval_elapsed`, `managed_input_changed`, `superseded_by` | report reasons, changed-path dispositions, reference resolution |
| `connectedPathChanges[]` | `{ path, beforeHash or null, afterHash or null, disposition: modified, deleted, added, renamed, renamedTo or null }` | report `changedPaths`, object lookups, rename detection at the deleting commit |
| `references[]` | `{ line, target, kind: link or path_mention, symbol or null, resolved, neverTracked }` | ADR-0464 reference extractor and resolution rule; `neverTracked` from one bounded Git history lookup ([ADR-0558](../../../decisions/knowledge/documents/freshness/0558-treat-never-tracked-path-mentions-as-not-removed.md)) |
| `publicationGroup` | `entrypoint`, `canonical`, `historical`, `generated`, `other` | path, layout roles, ADR-0464 historical classifier |
| `supersededBy` | path of a current document whose `supersedes` line links this one, or null | bounded `git grep` |
| `detectedAt` | first observation time of this finding digest | cycle record |

A reference is missing only when it is unresolved and not `neverTracked`. `neverTracked` is true for an unresolved path mention whose target no commit reachable from HEAD ever added, such as an example or fixture name; it raises no `reference_target_missing` reason and is not listed in the bundle's `unresolvedReferences`. A Markdown link is never `neverTracked`. A shallow clone, a Git failure, or a path Git cannot take literally counts the target as tracked ([ADR-0558](../../../decisions/knowledge/documents/freshness/0558-treat-never-tracked-path-mentions-as-not-removed.md)).

Drop evaluator reasons that only report unobserved evidence. Historical documents never become findings. Documents whose working bytes differ from HEAD wait until edits are committed, so freshness commits never carry uncommitted edits.

## Prioritization and admission

Compute `priorityClass` deterministically and record it on the candidate, in this order:

1. `safety`: a line touched by a reason matches a `documentFreshness.safetyPatterns` entry as a case-insensitive whole word. Touched lines contain a missing reference, excluding `neverTracked`, or a reference into a changed connected path; `superseded_by` touches every line. Inflections are not implied: `live` does not match "lives".
2. `entrypoint`: `publicationGroup` is `entrypoint`: a root `README.md`, `AGENTS.md`, or `CLAUDE.md`, or one directly inside a package or app directory.
3. `canonical`: `publicationGroup` is `canonical`.
4. `other`.

Within a class, sort by older `detectedAt`, then more `connectedPathChanges`, then path. Admit in that order until `maximumCandidatesPerCycle` or until the daily budget cannot cover another candidate at `maximumTokensPerCandidate`.

Never admit a finding under an active hold, a document owned by an open candidate, a finding already applied or reverted, an owner-rejected finding, or one with two rejected attempts. Dependency changes invalidate prior assessments. A generated `no_change_needed` response alone cannot settle a finding or suppress its warning; settlement requires the proof described below. A finding whose only reason is `review_interval_elapsed` settles deterministically as `no_change_needed`, without a provider call, and counts as a false positive. Missing-reference gates use the same `neverTracked` distinction as detection.

Budget accounting follows ADR-0459 turn measurement: one `resource.usage.recorded` per provider call, with `channel: knowledge_worker`, `stage: document_freshness`, and `turnEventId` equal to the call's generation identifier (`kfg_` plus 24 hex), recorded on the candidate as `generationId`. The same measurement records `context.selected` and `document.loaded` receipts for stale and related documents. Unobserved usage for a call that reached the model is charged at the applicable candidate bound. An observed total above `maximumTokensPerCandidate` rejects the candidate with `freshness_budget_exhausted`. Cross-check spending follows the [candidate contract](candidates.md#cross-check).

Generation follows per-change review governance (ADR-0457): active convergence delegation listing the provider, shared host provider admission, and an unpaused provider are required. Missing delegation, contended admission, or a paused provider defers generation. A version-check, no-capability-probe, or admission failure before a model call defers with `provider_not_admitted`, creates no rejected candidate, spends no candidate budget, and counts no attempt, as specified in the [operations contract](operations.md#events).

## Evidence bundle

Write `FreshnessEvidenceBundleV1` to CAS before the provider call; its hash becomes the candidate's `bundleHash`.

- `document`: `{ path, hash, text }`.
- `changedPaths[]`: for `modified`, `added`, and `renamed`, `{ path, beforeHash, afterHash, disposition, renamedTo, diff, excerpts }`. `diff` is a unified diff between verified and current revisions, bounded to 16 KiB per path and 64 KiB total. Beyond the bound, `diff` is null, `excerpts[]` contains at most 40 lines around symbols the document attaches to the path, and `evidenceTruncated` is true.
- `deletedPaths[]`: `{ path, lastRevision, deletedInCommit, replacements[] }`. Replacements come from rename detection at the deleting commit, definitions of symbols the document attached to the path (for example `class Limits`), and tracked files with the same basename. Each replacement carries a bounded excerpt of its current bytes.
- `relatedDocuments[]`: at most three `{ path, hash, excerpt }`, choosing `supersededBy` first when present, then Markdown documents mentioning a replacement path.
- `evidence[]`: every `{ path, hash }` a claim may cite.
- `writingContract`: active `writing_en-human` policy identifier and contract hash.
- `instructions`: fixed generation instruction.

The provider never receives absolute paths, event history, credentials, or other documents' full bodies.

The implemented related-document selector does not establish prepared-snapshot ranking or canonical-document eligibility. ADR-0463's intended requirement remains the top three related canonical documents from the prepared retrieval snapshot. Integrating and verifying that selection, or reviewing an amendment, remains open; path-and-hash bindings alone do not establish equivalence. See the [specification correction](../document-freshness.md#related-document-evidence-selection).

## Evidence recovery and assessment settlement

The first [maintenance recovery delivery](../document-freshness.md#recovery-and-assessment-implementation) expands changed Git trees into bounded regular-file evidence. Preflight prevents provider generation when evidence coverage is empty, unavailable, or incomplete. Complete directory-page assessments remain open in the [delivery plan](../../../roadmap/knowledge/maintenance-recovery-and-speed.md); bounded expansion does not prove complete coverage of every directory change.

An evidence-empty `needs_owner_input` candidate with no hunks, archive, output, approval, or rejection becomes `superseded` with `candidate_invalid`. This narrow recovery preserves genuine owner-held patches and owner rejections. Technical evidence failure does not become authority to apply a patch or a request to approve a nonexistent one.

A generated `no_change_needed` proposal requires a separate no-capability review and exact document, dependency, reference, policy, evidence, and verification bindings before detector settlement. The receipt lives in CAS with a `document.freshness.assessment.recorded` event. Reuse validates the private bounded projection against both. Missing or corrupt proof leaves the finding visible; dirty referenced sources invalidate reuse. Managed-input changes and unrelated staleness reasons remain unsuppressed.

A document with a missing reference cannot accept `no_change_needed`. Generation must resolve each reference listed in `unresolvedReferences`, or append ` (removed)` to a line recording a past fact about a removed target. Under ADR-0558, a never-tracked path mention is excluded from that list and must not be marked removed merely because it is absent. An edit cannot introduce a new absent path using that exemption.

Event schema 5 adds `document.freshness.evidence.recovered` and `document.freshness.assessment.recorded`. Both bind project, finding, document, evidence-contract, and receipt hashes with a timestamp. Recovery additionally records the predecessor candidate, bounded attempt, and `ready | incomplete | unavailable | exhausted`. Assessment records dependency and verification-contract hashes and `verified_no_change | changed | unavailable`. Payloads contain no document path or text. Writer selection remains unchanged until the exact configured reader inventory supports the complete history through version 5.

`freshness_evidence_unavailable`, `freshness_evidence_incomplete`, and `freshness_evidence_recovery_exhausted` identify technical recovery states exposed by `lervo knowledge freshness status`; none requests owner approval. `freshness_assessment_reader_transition_required` means a schema-5 receipt cannot yet be written and establishes neither currency nor permission to select a new writer. Installed activation and supersession of legacy empty candidates do not by themselves prove replacement evidence recovery or a valid assessment receipt.
