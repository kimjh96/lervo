# Document freshness

Status: `wired`
As of: 2026-10-05

This contract implements [ADR-0463](../../decisions/knowledge/documents/0463-refresh-stale-documents-with-evidence-bound-minimal-edits.md). It names the data the loop consumes and produces, the checks that make a candidate `verified`, the authority rules at apply, the surfaces, the events, the policy keys, and the fixtures. The roadmap labels state which parts are wired.

## Pipeline

```
ADR-0464 detection ─► finding mapping ─► prioritize ─► admit (budget) ─► bundle evidence
   ─► governed generation ─► deterministic checks ─► cross-check gate ─► authority ─► apply ─► commit
                                         │                    │              │
                                         └─► rejected         │              └─► waiting for the owner
                                                              └─► verified_pending_cross_check (version 1)
```

Stage owner: the knowledge resident (`packages/repository-knowledge-runtime/src/freshness-stage.ts`), as a stage after per-change intake and convergence in `runAutonomousKnowledgeWorker`. A stage failure never blocks intake or convergence. Candidate state lives under `.lervo/state/knowledge/freshness-candidates/<2-hex shard>/kfresh_<24 hex>.json`, holds under `.lervo/state/knowledge/freshness-holds/`, and the cycle record in `.lervo/state/knowledge/freshness-cycle.json`. Bundles and before-bytes live in CAS. All of it is rebuildable from events plus the repository. Retention removes terminal candidates after 30 days and keeps at most 512 candidates and 512 holds.

The stage has its own fence: a digest of HEAD, the working-tree status, the policy, holds, and candidate states. An unchanged fence skips the stage without writing. The ADR-0461 resident fingerprint gains the recorded `findingsDigest` and the hold store; the candidate store is already observed as a `*-candidates` directory.

## Detection input

The loop reads one `DocumentFreshnessFindingV1` per document. `observeDocumentFreshnessFindings` in `@lervo/repository-knowledge` runs `lervo knowledge lint` in `evaluate_and_record` mode, reads `readRecordedDocumentStalenessReport` ([ADR-0464](../../decisions/knowledge/documents/0464-report-document-drift-and-historical-documents.md)), and uses the report only when its `currentRevision` equals HEAD. The pure function `documentFreshnessFinding` maps the report entry and the detection-side enrichment to the finding; the freshness stage infers no field itself.

| Field                    | Type                                                                                                                                                | Source                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `findingDigest`          | sha256 of the canonical finding excluding `detectedAt`                                                                                              | mapping                                                                            |
| `sources[]`              | `document_stale`, `entrypoint_reference_missing`, `markdown_link_target_missing`                                                                    | ADR-0464 report and drift lint codes                                               |
| `documentPath`           | repository-relative path                                                                                                                            | report or lint finding                                                             |
| `documentHash`           | sha256 of the current bytes                                                                                                                         | working tree                                                                       |
| `verifiedRevision`       | the report's verified revision, or null for lint-only findings                                                                                      | ADR-0464 report                                                                    |
| `currentRevision`        | HEAD                                                                                                                                                | Git                                                                                |
| `reasons[]`              | `connected_path_changed`, `connected_path_deleted`, `reference_target_missing`, `review_interval_elapsed`, `managed_input_changed`, `superseded_by` | report reasons, changed-path dispositions, reference resolution                    |
| `connectedPathChanges[]` | `{ path, beforeHash or null, afterHash or null, disposition: modified, deleted, added, renamed, renamedTo or null }`                                | report `changedPaths`, object lookups, and rename detection at the deleting commit |
| `references[]`           | `{ line, target, kind: link or path_mention, symbol or null, resolved }`                                                                            | the ADR-0464 reference extractor and resolution rule                               |
| `publicationGroup`       | `entrypoint`, `canonical`, `historical`, `generated`, `other`                                                                                       | path, layout roles, and the ADR-0464 historical classifier                         |
| `supersededBy`           | path of a current document whose `supersedes` line links this one, or null                                                                          | bounded `git grep`                                                                 |
| `detectedAt`             | first observation time of this finding digest                                                                                                       | cycle record                                                                       |

Evaluator reasons that only say evidence is unobserved are dropped. A historical document never becomes a finding. A document whose working bytes differ from HEAD waits until its edits are committed, so a freshness commit never carries an uncommitted edit.

## Prioritization and admission

`priorityClass` is computed deterministically and recorded on the candidate:

1. `safety`: any line a reason touches (an unresolved reference, or a reference into a changed connected path; every line for `superseded_by`) matches one of `documentFreshness.safetyPatterns` as a case-insensitive whole word. Inflections are not implied, so `live` does not match "lives".
2. `entrypoint`: `publicationGroup` is `entrypoint`: a root `README.md`, `AGENTS.md`, or `CLAUDE.md`, or one directly inside a package or app directory.
3. `canonical`: `publicationGroup` is `canonical`.
4. `other`.

Within a class, older `detectedAt` first, then more `connectedPathChanges` first, then path order. A cycle admits findings in that order until `maximumCandidatesPerCycle`, or until the daily budget could no longer cover one more candidate at `maximumTokensPerCandidate`. It never admits a finding under an active hold, a document an open candidate still owns, a finding already applied, reverted, or settled as `no_change_needed`, a finding the owner rejected, or a finding with two rejected attempts. Those wait until the document or a connected path changes. A finding whose only reason is `review_interval_elapsed` settles deterministically as `no_change_needed` without a provider call and counts as a false positive.

Budget accounting uses the ADR-0459 turn measurement: one `resource.usage.recorded` per provider call with `channel: knowledge_worker`, `stage: document_freshness`, and `turnEventId` set to the call's generation identifier (`kfg_` plus 24 hex), which the candidate records as `generationId`. The same measurement records the `context.selected` and `document.loaded` receipts for the stale and related documents. Unobserved usage is recorded as unavailable and charged at `maximumTokensPerCandidate`. A call whose observed total exceeds `maximumTokensPerCandidate` rejects its candidate with `freshness_budget_exhausted`.

Generation is governed like per-change review (ADR-0457): it needs the active convergence delegation listing the provider, the shared host provider admission, and an unpaused provider. A missing delegation, contended admission, or paused provider defers the finding without writing anything.

## Evidence bundle

`FreshnessEvidenceBundleV1` is written to CAS before the provider call, and its hash is the candidate's `bundleHash`.

- `document`: `{ path, hash, text }`.
- `changedPaths[]`: for `modified`, `added`, and `renamed`, `{ path, beforeHash, afterHash, disposition, renamedTo, diff, excerpts }`, where `diff` is a unified diff between the verified and current revisions bounded to 16 KiB per path and 64 KiB in total. Beyond the bound, `diff` is null, `excerpts[]` holds at most 40 lines around the symbols the document attaches to the path, and `evidenceTruncated` is true.
- `deletedPaths[]`: `{ path, lastRevision, deletedInCommit, replacements[] }`. Replacements come from rename detection at the deleting commit, from definitions of symbols the document attached to the path (for example `class Limits`), and from tracked files with the same basename; each carries a bounded excerpt of its current bytes.
- `relatedDocuments[]`: at most three `{ path, hash, excerpt }`: `supersededBy` when present, then Markdown documents that mention a replacement path.
- `evidence[]`: every `{ path, hash }` a claim may cite.
- `writingContract`: the active `writing_en-human` policy identifier and contract hash.
- `instructions`: the fixed generation instruction.

The provider never receives absolute paths, event history, credentials, or other documents' full bodies.

## Candidate

The provider returns `{ operation, hunks[], archiveName, currentDocumentPath, explanation }`. Each hunk names `before` text that must occur exactly once in the document, its replacement `after`, and claims citing bundle evidence. Lervo derives byte ranges from the unique match, so a provider can never select unrelated bytes. A response outside this contract rejects the candidate as `candidate_invalid`.

`DocumentFreshnessCandidateV1`:

- `candidateId` (`kfresh_` plus 24 hex, derived from decision content excluding time), `generationId`, `findingDigest`, `bundleHash`, `documentPath`, `sourceHash`, `priorityClass`, `operation`.
- `operation: edit`: `hunks[]` of `{ hunkId, range: { startByte, endByte }, beforeHash, replacement, changeClass, ownership, managedBlockId or null, authorityRequired, crossCheckRequired, claims[] }` with `claims[]` of `{ claimDigest, text, evidence[]: { path, hash, lineRange or null } }`.
- `operation: archive`: `archive` with `targetPath` under `documentFreshness.historicalRoot`, `banner`, `inboundLinkRewrites[]` and `outgoingLinkRewrites[]` of `{ path, line, from, to }`, `ownership`, and the content hash of every rewritten inbound document.
- `operation: no_change_needed` or `needs_owner_input`: `explanation` (at most 1 KiB).
- `authorityRequired: none | principal_mandate | owner`, `state`, `checks[]`, `crossCheck`, `beforeBytesRef` (CAS), `afterHash` of the full verified output, `appliedHash` after the latest apply, `appliedHunkIds[]`, `pendingHunkIds[]`, `tokensObserved`, `rejection`, `approval`, `commitHash`, and `acknowledgedAt`.

States: `generated`, `verified`, `verified_pending_cross_check`, `waiting_authority`, `applied`, `partially_applied`, `rejected`, `superseded`, `reverted`. `verified` is transient for edits Lervo applies itself and final for `no_change_needed`. `verified_pending_cross_check` means every deterministic check passed but a hunk needs Tier 0; until Tier 0 exists the owner reviews it instead. `partially_applied` means Lervo-managed hunks applied and the rest wait; the candidate records both sets.

### Change class rules

- `safety_or_policy`: a source line the hunk spans matches a safety pattern, or the document is `AGENTS.md` or `CLAUDE.md` at any depth and a spanned line is an instruction (it starts with a verb from a closed imperative list, optionally after a list marker), or the document is a decision record and the hunk lies under its `## Decision` heading. This class wins over the others.
- `factual_reference`: every token the replacement adds (paths, symbols, versions, commands, and numbers with their units) appears byte-exact in the text of the evidence the hunk's claims cite.
- `statement`: everything else.

### Deterministic checks

Each check records `{ code, status: passed or failed, detail }` on the candidate; the `verified` event carries `{ code, status }`.

| Code                          | Rule                                                                                                                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source_hash`                 | current document hash equals `sourceHash`                                                                                                                                                                       |
| `outside_bytes_unchanged`     | every byte outside the hunk ranges is identical after apply, checked independently of how the output was produced                                                                                               |
| `commonmark_structure`        | output parses; heading count, depth, and text are unchanged unless a `factual_reference` hunk spans the heading line; `lervo_v1` marker bytes and block identifiers are unchanged                               |
| `references_resolve`          | every relative link and path span in the output resolves in the current tree under the ADR-0464 rule, or sits on a line that marks history (`historical`, `archived`, `superseded`, `formerly`, `removed`, ...) |
| `missing_references_resolved` | every unresolved reference of the finding is replaced, removed, or marked historical                                                                                                                            |
| `claims_bound`                | every hunk has a claim, and every claim cites at least one `{ path, hash }` from the bundle evidence                                                                                                            |
| `edit_bound`                  | changed bytes, measured per hunk after the common prefix and suffix, are at most 25 percent of the document and 4 KiB                                                                                           |
| `entrypoint_bounds`           | an entrypoint may not grow past `README.md` 12,288 bytes and 160 lines, `AGENTS.md` 8,192 and 120, or `CLAUDE.md` 2,048 and 40; ADR-0206 protected README coordinates are unchanged except repository paths     |
| `writing_contract`            | the replacement adds no deterministic `writing_en-human` violation the replaced text did not have                                                                                                               |

An archive records `source_hash`, `outside_bytes_unchanged` (the target path is free), and `edit_bound` (the banner fits `maximumEditBytes`).

### Cross-check

Required when any hunk is `statement` or `safety_or_policy`, when the hunk's bytes are user-owned, or when `operation` is `archive`; `crossCheck: always` requires it everywhere and `never` is refused for user-owned bytes. The design enqueues an ADR-0460 Tier 0 `cross_check` with `DecisionPointSignal.kind: document_freshness` and the fixed question "For each hunk, does the replacement follow from the cited evidence, and does the candidate change nothing else?" `agreement` would mark the candidate `verified`; `material_disagreement` rejects it with `cross_check_disagreement` and the contested `hunkId`s, regenerates once, and a second disagreement raises `document_freshness_blocked`.

Version 1 has no Tier 0, because ADR-0460 Slice 1 is not implemented. The candidate records `crossCheck: unavailable`, every hunk that needs the cross-check carries `crossCheckRequired: true`, and the candidate waits in `verified_pending_cross_check`. Owner approval substitutes for the missing cross-check, and nothing in that state applies without it.

## Authority and apply

Ownership resolution, in order: a range inside one `lervo_v1` managed block's content is Lervo-managed; a path under the publication root (`docs/knowledge/` by default) or a layout role with `lifecycleOwner: lervo` or `rewritePolicy: lervo_exact` is Lervo-managed; everything else is user-owned, including `repository_tool` roles and documents without a role. A hunk is classified by the ownership of its byte range, so one candidate can carry both. A range that touches a marker fails `commonmark_structure`.

| Ownership     | Class               | Authority                                                                              | Version 1 effect                    |
| ------------- | ------------------- | -------------------------------------------------------------------------------------- | ----------------------------------- |
| Lervo-managed | `factual_reference` | `none`: apply in the verifying cycle                                                   | applies                             |
| Lervo-managed | `statement`         | `none`: apply in the verifying cycle                                                   | owner, until Tier 0 agrees          |
| Lervo-managed | `safety_or_policy`  | `owner`                                                                                | owner                               |
| User-owned    | `factual_reference` | `principal_mandate` when an installed mandate lists `document_freshness`; else `owner` | owner; no mandate kind is installed |
| User-owned    | `statement`         | `owner`                                                                                | owner                               |
| User-owned    | `safety_or_policy`  | `owner`                                                                                | owner                               |

Apply is one sequence under the knowledge worker's repository lock: re-check that the bytes equal the expected hash (`appliedHash` after a partial apply, else `sourceHash`) and that the first apply starts from committed bytes, store the before-bytes in CAS, write the output atomically, commit only the touched paths as `Lervo Knowledge` with the trailer `Lervo-Freshness-Candidate: <candidateId>`, update the candidate, and record `document.freshness.candidate.applied`. When every newly applied hunk sits in a managed block, the output is produced through the ADR-0022 managed-block patch and must equal the verified hunk output. A changed source supersedes the candidate with `source_changed`. A failed write restores the pre-image and records `rejected` with `write_failed`. An unsafe or contended commit leaves the written bytes and records `commitHash: null`.

Owner approval binds `candidateId` and `afterHash`: `lervo knowledge freshness apply <candidateId> --approval <afterHash>`. It applies every pending hunk, or the archive, and fails with `approval_mismatch`, `source_changed`, or `freshness_hold_active` without writing. A proxy approval would record `approvalSource: principal_mandate` and the mandate hash; no proxy path exists in version 1.

Revert: `lervo knowledge freshness revert <candidateId>` restores `beforeBytesRef` when the current hash equals `appliedHash`, commits with `Lervo-Freshness-Revert: <candidateId>`, records `reverted`, and writes a hold `{ findingDigest, documentPath, candidateId, reason: reverted, until }`. A hash mismatch fails with `revert_conflict` and names the three coordinates to reconcile by hand. An archive revert restores the source and every rewritten inbound document from the CAS pre-image. `lervo knowledge freshness reject <candidateId> --reason not_stale` sets the same hold and counts as a false positive; `--reason incorrect` only closes the candidate.

## Surfaces

- `lervo knowledge freshness status [--root <path>] [--json]`: counts per state and priority class, the oldest open candidate with its age, budget used today, the hold list, and the time-to-fresh of the last ten applies.
- `lervo knowledge freshness review [<candidateId>] [--json]`: without an identifier, lists candidates awaiting the owner with their exact apply command; with one, prints each hunk as a unified diff with its claims and evidence coordinates, the check table, and the cross-check outcome.
- `lervo knowledge freshness apply|revert|reject|acknowledge <candidateId>`: as above. `acknowledge` resolves an applied notice.
- Attention items, in `lervo application attention` and the cached retrieval prompt path: `document_freshness_candidate` (`actionOwner: user`, `requiresUserAction: true`, `blocking: false`, fields `candidateId`, `documentPath`, `priorityClass`, `changeClasses`, `hunkCount`, `instruction`); `document_freshness_applied` (`actionOwner: agent`, informational, fields `candidateId`, `documentPath`, `approvalSource`, `commitHash`, `revertInstruction`; it resolves when acknowledged or after 24 hours); `document_freshness_blocked` (`actionOwner: user`, fields `reasonCode`, `documentPath` or null, `attempts`, `instruction`). None is blocking, so they stay within the ADR-0462 twelve-item, 4 KiB attention budget.
- Compact terminal context: one preamble line of at most 200 bytes, only when any count is non-zero, for example `Document freshness: 2 stale (1 safety: AGENTS.md), 1 candidate awaits review; lervo knowledge freshness review`.
- Turn-report segment: `documentFreshnessTurnReportSegment` renders `docs: 1 refreshed (README.md), 1 awaiting owner`. No host renders an ADR-0459 turn report yet, so the segment has no consumer.
- Escalation batch: `documentFreshnessEscalationQuestion` renders "Apply freshness candidate `<id>` to `<path>` (`<classes>`)?", and `documentFreshnessApprovalFromReply` translates an owner reply to the exact apply command. An explicit candidate identifier always wins, and a bare affirmative binds only when exactly one candidate waits. The ADR-0453 escalation batch does not exist yet, so neither has a consumer.

## Events

All payloads carry relative paths, hashes, counts, codes, and identifiers only. Hunks, claims, evidence bodies, explanations, and before-bytes stay in CAS and the candidate store. The events exist in event schema 4; a repository whose writer is older cannot record them, so the stage reports `unavailable` and the CLI refuses owner operations. `usageObserved` is the provider's total token count, named without "token" because event redaction drops any key containing it.

| Event                                   | Required fields                                                                                                                                                                                                       |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document.freshness.candidate.created`  | `candidateId`, `findingDigest`, `documentPath`, `documentHash`, `operation`, `priorityClass`, `changeClasses`, `hunkCount`, `evidenceCount`, `evidenceTruncated`, `usageObserved`, `occurredAt`                       |
| `document.freshness.candidate.verified` | `candidateId`, `checks[]` (`code`, `status`), `crossCheck` (`not_required`, `agreement`, `material_disagreement`, `unavailable`), `deliberationRunId` or null, `authorityRequired`, `afterHash`, `occurredAt`         |
| `document.freshness.candidate.applied`  | `candidateId`, `documentPath`, `beforeHash`, `afterHash`, `appliedHunkCount`, `pendingHunkCount`, `approvalSource` (`lervo_managed`, `principal_mandate`, `owner`), `approvalRef`, `commitHash` or null, `occurredAt` |
| `document.freshness.candidate.rejected` | `candidateId`, `reasonCode`, `rejectorKind` (`deterministic`, `cross_check`, `proxy`, `owner`, `budget`), `contestedHunkIds[]`, `occurredAt`                                                                          |
| `document.freshness.candidate.reverted` | `candidateId`, `documentPath`, `restoredHash`, `revertedBy` (`owner`, `agent`), `holdUntil`, `occurredAt`                                                                                                             |
| `document.freshness.cycle.completed`    | `cycleId` (`kfcy_` plus 24 hex), `findingCount`, `admittedCount`, `candidateCount`, `verifiedCount`, `appliedCount`, `skippedForBudget`, `skippedForHold`, `usageObserved`, `occurredAt`                              |

Failure meaning: `claim_unbound`, `reference_unresolved`, `outside_bytes_changed`, `candidate_invalid`, and `cross_check_disagreement` reject the candidate and leave the document unchanged; `source_changed` supersedes it and a new candidate follows once the edit is committed; `freshness_budget_exhausted` rejects an over-budget call or defers the finding to a cycle with budget; `write_failed` restores the pre-image; `owner_rejected` closes the candidate; `revert_conflict` leaves the document as found; `freshness_hold_active` refuses apply until the hold ends. Five attempts with zero verified candidates in one day raise `document_freshness_blocked` with `reasonCode: zero_success_window`.

## Policy keys

Under `documentFreshness` in `.lervo/knowledge/policy.yaml`, all optional with these defaults: `enabled: true`, `safetyPatterns: [risk, limit, leverage, loss, credential, secret, deploy, production, live]`, `maximumCandidatesPerCycle: 3`, `maximumTokensPerCandidate: 30000`, `maximumTokensPerDay: 150000`, `maximumEditRatio: 0.25`, `maximumEditBytes: 4096`, `historicalRoot: docs/archive`, `holdDays: 7`, and `crossCheck: required_for_consequential` (or `always` or `never`, where `never` is refused for user-owned bytes). An unknown key or an out-of-bound value fails policy validation. The principal mandate key `maximumFreshnessApprovalsPerDay` (default 5) waits for the mandate kind.

## Fixtures and journey

Domain cases live in `packages/repository-knowledge/test/document-freshness.test.ts`. The Argo fixtures live in `packages/repository-knowledge-runtime/test/document-freshness-fixtures.test.ts` and run the real stage against scratch Git repositories. The fixture provider is `scripts/distribution/fixtures/document-freshness-claude.mjs`, which answers the no-capability JSON contract from a plan file beside it.

| Id  | Scenario (from Argo history)                                                                                                            | Expected in version 1                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | `AGENTS.md` says risk limits live in `v2/argo_v2/live/engine.py: Limits`; `v2/` deleted; `v4/argo4/live/engine.py` holds `class Limits` | `safety`, two `safety_or_policy` hunks, `crossCheck: unavailable`, `authorityRequired: owner`, `verified_pending_cross_check`, one usage record, first cycle |
| F2  | `README.md` links `v2/README.md` (missing) and says "every 6 hours"; `v4/README.md` says "daily at 00:40 UTC"                           | `entrypoint`, two `factual_reference` user-owned hunks, `owner` (no mandate kind), `references_resolve` passes                                               |
| F3  | Root `FINAL-DESIGN.md` describes removed v1; `IMPLEMENTATION-HANDOFF.md` deleted; nine inbound links                                    | `archive` to `docs/archive/v1-final-design.md` with banner and nine `inboundLinkRewrites`; `owner`; owner apply moves it and commits with the trailer        |
| F4  | Unrelated edit under `v3/scripts`; a document already correct but flagged by `review_interval_elapsed`                                  | no candidate for the edit; deterministic `no_change_needed` without a provider call                                                                          |
| F5  | Owner edits the document while a candidate waits                                                                                        | `source_changed`, state `superseded`, a new candidate after the edit is committed                                                                            |
| F6  | Apply F2 then revert                                                                                                                    | approval mismatch refused, owner apply commits as `Lervo Knowledge`, revert restores the bytes, `reverted`, hold set, no candidate the next day              |
| F7  | `AGENTS.md` hunk inside a `lervo_v1` block plus one in user prose                                                                       | `partially_applied`; managed hunk applied through the ADR-0022 patch and committed; user hunk waits; owner apply completes it                                |

Installed journey (`installed-document-freshness-v1`): on a copy of the Lervo repository with the knowledge resident's freshness stage, rename a referenced path and commit; assert a finding within one change-driven cycle, a Lervo-managed hunk applied and committed with the trailer, a user-owned candidate waiting for the owner, and `status` showing the time to fresh. The first local run uses the fixture provider; a real-provider run and an evidence document under `docs/evidence/quality/` remain open.

## Metrics

Computed weekly from the events above and reported beside the ADR-0459 projections: time to fresh (`detectedAt` to `applied`, per `priorityClass`, median and p90), time to candidate (`detectedAt` to `verified`), false-positive rate (`no_change_needed` plus owner `not_stale` rejections over candidates), acceptance rate (`applied` over `verified`), tokens per applied update, revert rate, and cross-check disagreement rate. Targets are in ADR-0463. The weekly projection is not built yet; `lervo knowledge freshness status` reports time to fresh per apply.

## References

- [ADR-0023 evidence-based document staleness](../../decisions/knowledge/documents/0023-evidence-based-document-staleness.md)
- [ADR-0464 document drift and historical documents](../../decisions/knowledge/documents/0464-report-document-drift-and-historical-documents.md)
- [ADR-0462 workstream bookkeeping and stale attention](../../decisions/execution/applications/0462-own-workstream-bookkeeping-and-stale-attention.md)
- [ADR-0022 byte-preserving managed-block patch candidates](../../decisions/knowledge/documents/0022-byte-preserving-managed-block-patch-candidate.md)
- [ADR-0206 public README preservation](../../decisions/knowledge/documents/0206-public-readme-preservation-and-improvement.md)
- [Background knowledge convergence runtime](../../specs/background-knowledge-convergence/runtime.md)
- [Operating attention](../execution/operating-attention.md)
- [Open collaboration platform roadmap](../../roadmap/open-collaboration-platform.md)
