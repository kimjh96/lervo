# Document freshness pipeline

## Pipeline

```text
ADR-0464 detection ─► finding mapping ─► prioritize ─► admit (budget) ─► bundle evidence
   ─► governed generation ─► deterministic checks ─► Tier 0 cross-check ─► authority ─► apply ─► commit
                                         │                    │                   │
                                         └─► rejected         ├─► rejected        └─► waiting for the owner
                                                              │   (disagreement)
                                                              └─► verified_pending_cross_check (unavailable)
```

The knowledge resident owns the stage (`packages/repository-knowledge-runtime/src/freshness-stage.ts`), which follows per-change intake and convergence in `runAutonomousKnowledgeWorker`. Stage failure never blocks intake or convergence.

Freshness and convergence share the worker's repository lock and never run concurrently. Freshness runs only while convergence is parked (`idle`, `current`, `waiting_authority`, or `attention_required`); otherwise the cycle reports `yielded`. A freshness commit moves HEAD like a developer commit. This rule prevents it from landing between an [ADR-0465](../../../decisions/knowledge/documents/0465-commit-settled-knowledge-documents-at-batch-boundaries.md) batch-boundary commit and the stage that commit re-queued under its `committedHead` fence. Documents with uncommitted settled outputs are never refreshed: their working bytes differ from HEAD. Owner operations also refuse while any live or interrupted materialization journal owns the repository.

Candidate state lives under `.lervo/state/knowledge/freshness-candidates/<2-hex shard>/kfresh_<24 hex>.json`, holds under `.lervo/state/knowledge/freshness-holds/`, and the cycle record in `.lervo/state/knowledge/freshness-cycle.json`. Bundles and before-bytes live in CAS. All are rebuildable from events plus the repository. Retention removes terminal candidates after 30 days and keeps at most 512 candidates and 512 holds.

The stage fence digests HEAD, working-tree status, policy, holds, and candidate states. An unchanged fence skips the stage without writing. The ADR-0461 resident fingerprint includes the recorded `findingsDigest` and hold store; the candidate store is already observed as a `*-candidates` directory.

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
| `references[]` | `{ line, target, kind: link or path_mention, symbol or null, resolved }` | ADR-0464 reference extractor and resolution rule |
| `publicationGroup` | `entrypoint`, `canonical`, `historical`, `generated`, `other` | path, layout roles, ADR-0464 historical classifier |
| `supersededBy` | path of a current document whose `supersedes` line links this one, or null | bounded `git grep` |
| `detectedAt` | first observation time of this finding digest | cycle record |

Drop evaluator reasons that only report unobserved evidence. Historical documents never become findings. Documents whose working bytes differ from HEAD wait until edits are committed, so freshness commits never carry uncommitted edits.

## Prioritization and admission

Compute `priorityClass` deterministically and record it on the candidate, in this order:

1. `safety`: a line touched by a reason matches a `documentFreshness.safetyPatterns` entry as a case-insensitive whole word. Touched lines contain an unresolved reference or a reference into a changed connected path; `superseded_by` touches every line. Inflections are not implied: `live` does not match "lives".
2. `entrypoint`: `publicationGroup` is `entrypoint`: a root `README.md`, `AGENTS.md`, or `CLAUDE.md`, or one directly inside a package or app directory.
3. `canonical`: `publicationGroup` is `canonical`.
4. `other`.

Within a class, sort by older `detectedAt`, then more `connectedPathChanges`, then path. Admit in that order until `maximumCandidatesPerCycle` or until the daily budget cannot cover another candidate at `maximumTokensPerCandidate`.

Never admit a finding under an active hold, a document owned by an open candidate, a finding already applied, reverted, or settled as `no_change_needed`, an owner-rejected finding, or one with two rejected attempts. Those wait until the document or a connected path changes. A finding whose only reason is `review_interval_elapsed` settles deterministically as `no_change_needed`, without a provider call, and counts as a false positive.

Budget accounting follows ADR-0459 turn measurement: one `resource.usage.recorded` per provider call, with `channel: knowledge_worker`, `stage: document_freshness`, and `turnEventId` equal to the call's generation identifier (`kfg_` plus 24 hex), recorded on the candidate as `generationId`. The same measurement records `context.selected` and `document.loaded` receipts for stale and related documents. Unobserved usage is recorded as unavailable and charged at `maximumTokensPerCandidate`. An observed total above `maximumTokensPerCandidate` rejects the candidate with `freshness_budget_exhausted`.

Generation follows per-change review governance (ADR-0457): active convergence delegation listing the provider, shared host provider admission, and an unpaused provider are required. Missing delegation, contended admission, or a paused provider defers the finding without writing anything.

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
