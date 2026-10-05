# Document freshness

Status: `planned`
As of: 2026-10-05

This contract implements [ADR-0463](../../decisions/knowledge/documents/0463-refresh-stale-documents-with-evidence-bound-minimal-edits.md). It names the data the loop consumes and produces, the checks that make a candidate `verified`, the authority rules at apply, the surfaces, the events, the policy keys, and the fixtures. Everything here is `contract-only` until the roadmap labels say otherwise.

## Pipeline

```
detection report ─► prioritize ─► admit (budget) ─► bundle evidence ─► generate candidate
   ─► deterministic checks ─► cross-check (when required) ─► authority ─► apply ─► commit
                                        │                        │
                                        └─► rejected             └─► waiting_authority ─► owner / proxy
```

Stage owner: the knowledge resident (`packages/repository-knowledge-runtime`), as a stage after per-change intake. Candidate state lives under `.lervo/state/knowledge/freshness-candidates/<2-char shard>/kfresh_<24 hex>.json`; bundles and before-bytes live in CAS. All of it is rebuildable from events plus the repository.

## Detection input

The loop reads a `DocumentFreshnessFindingV1` per stale document. The parallel detection change produces it or a shape that maps to it by a pure function; no field below may be inferred by the freshness stage itself.

| Field                    | Type                                                                                                                                                | Source                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `findingDigest`          | sha256 of the canonical finding excluding `detectedAt`                                                                                              | detection                            |
| `stalenessResultId`      | `DocumentStalenessResult.resultId`                                                                                                                  | ADR-0023                             |
| `documentPath`           | repository-relative path                                                                                                                            | manifest                             |
| `documentHash`           | sha256 of current bytes                                                                                                                             | snapshot                             |
| `verifiedRevision`       | revision whose snapshot the document was last verified against, or null                                                                             | ADR-0023                             |
| `currentRevision`        | revision of the current snapshot                                                                                                                    | snapshot                             |
| `reasons[]`              | `connected_path_changed`, `connected_path_deleted`, `reference_target_missing`, `review_interval_elapsed`, `managed_input_changed`, `superseded_by` | ADR-0023 signals plus reference scan |
| `connectedPathChanges[]` | `{ path, beforeHash or null, afterHash or null, disposition: modified, deleted, added, renamed, renamedTo or null }`                                | two snapshots plus rename detection  |
| `references[]`           | `{ line, target, kind: link or path_mention, resolved: boolean }` for the document's outgoing references                                            | reference scan                       |
| `publicationGroup`       | `entrypoint`, `canonical`, `historical`, `generated`, `other`                                                                                       | document layout                      |
| `supersededBy`           | path of a canonical successor that names this document as superseded, or null                                                                       | reference scan                       |
| `detectedAt`             | time                                                                                                                                                | detection                            |

## Prioritization and admission

`priorityClass` is computed deterministically and recorded on the candidate:

1. `safety`: any line of the document that a reason touches matches one of `documentFreshness.safetyPatterns` (case-insensitive word match).
2. `entrypoint`: `publicationGroup` is `entrypoint`, or the document fills a `document-layout.yaml` role with `scopePath: .`, or it is a package `AGENTS.md`.
3. `canonical`: `publicationGroup` is `canonical`.
4. `other`.

Within a class, older `detectedAt` first, then more `connectedPathChanges` first, then path order. A cycle admits findings in that order until `maximumCandidatesPerCycle` or the daily token budget is reached, and never admits a finding under an active `freshnessHold` or one whose latest candidate is `waiting_authority`. A finding whose last candidate was `rejected` by `cross_check_disagreement` twice is not admitted again until the document or a connected path changes.

Budget accounting uses `resource.usage.recorded` with `channel: knowledge_worker`, `stage: document_freshness`, and the candidate identifier as `turnEventId` correlation. The Tier 0 cross-check records its own usage under `scope: deliberation` and counts against the candidate's 30,000-token bound.

## Evidence bundle

`FreshnessEvidenceBundleV1` is written to CAS before the provider call and referenced by the candidate.

- `document`: `{ path, hash, bytes }`.
- `changedPaths[]`: for `modified` and `renamed`, `{ path, beforeHash, afterHash, diff }` where `diff` is a unified diff bounded to 16 KiB per path and 64 KiB in total; beyond the bound, `diff` is replaced by `excerpts[]` of at most 40 lines around each symbol or path the document mentions, and `evidenceTruncated` is true.
- `deletedPaths[]`: `{ path, lastRevision, deletedInCommit, replacements[] }` where replacements come from Git rename similarity at or above 50 percent and from a symbol search over the current tree for identifiers the document attached to the path (for example `class Limits`).
- `relatedDocuments[]`: at most three `{ path, hash, excerpt }` chosen by the prepared retrieval snapshot for the document title and the stale lines; `supersededBy` is always included when present.
- `writingContract`: the active `writing_en-human` policy identifier and hash.
- `instructions`: the fixed generation instruction: edit only lines the cited evidence invalidates, keep structure, cite evidence per claim, prefer `no_change_needed` over speculation, prefer `needs_owner_input` when the evidence does not determine the new value.

The provider never receives absolute paths, event history, credentials, or other documents' bodies.

## Candidate

`DocumentFreshnessCandidateV1`:

- `candidateId` (`kfresh_` plus 24 hex, derived from canonical content excluding time), `findingDigest`, `bundleHash`, `documentPath`, `sourceHash`, `priorityClass`, `operation`.
- `operation: edit`: `hunks[]` of `{ hunkId, range: { startByte, endByte }, beforeHash, replacement, changeClass, claims[] }` with `claims[]` of `{ claimDigest, text, evidence[]: { path, hash, lineRange or null } }`.
- `operation: archive`: `targetPath` under `documentFreshness.historicalRoot`, `banner` bytes, `inboundLinkRewrites[]` of `{ path, line, from, to }`.
- `operation: no_change_needed` or `needs_owner_input`: `explanation` (bounded to 1 KiB) and the reasons addressed.
- `authorityRequired: none | principal_mandate | owner`, `state`, `beforeBytesRef` (CAS), `afterHash` after verification, `tokensObserved`.

States: `generated`, `verified`, `waiting_authority`, `applied`, `partially_applied`, `rejected`, `superseded`, `reverted`. `partially_applied` means Lervo-managed hunks applied and user-owned hunks wait; the candidate records both sets.

### Change class rules

- `factual_reference`: the replacement differs from the source only in tokens that appear byte-exact in cited evidence (paths, symbols, versions, commands, numbers with their units). Checked by tokenizing both sides and matching every changed token against the evidence bytes.
- `safety_or_policy`: the hunk's source line matches a safety pattern, or the document is `AGENTS.md`, `CLAUDE.md`, or a package `AGENTS.md` and the line is an instruction (starts with an imperative verb or a list marker followed by one), or the document is a decision record and the hunk lies under its `## Decision` heading. This class wins over the others.
- `statement`: everything else.

### Deterministic checks

Each check records `{ code, status: passed or failed, detail }` on the `verified` or `rejected` event.

| Code                          | Rule                                                                                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source_hash`                 | current document hash equals `sourceHash`                                                                                                                        |
| `outside_bytes_unchanged`     | every byte outside the hunk ranges is identical after apply                                                                                                      |
| `commonmark_structure`        | output parses; heading count and order unchanged unless the hunk class is `factual_reference` on a heading; `lervo_v1` markers and block identifiers unchanged   |
| `references_resolve`          | every relative link and every backticked token that looks like a path in the output exists in the current tree, or sits in a line containing a historical marker |
| `missing_references_resolved` | every `reference_target_missing` reason is replaced, removed, or marked historical                                                                               |
| `claims_bound`                | every hunk has at least one claim, every claim cites at least one bundle evidence item, and `factual_reference` tokens match                                     |
| `edit_bound`                  | changed bytes at or below 25 percent of the document and 4 KiB; `archive` changes no body byte except the banner                                                 |
| `entrypoint_bounds`           | `README.md` 12,288 bytes and 160 lines, `AGENTS.md` 8,192 and 120, `CLAUDE.md` 2,048 and 40; ADR-0206 protected README coordinates unchanged                     |
| `writing_contract`            | `writing_en-human` passes on the changed lines                                                                                                                   |

### Cross-check

Required when any hunk is `statement` or `safety_or_policy`, when the document is user-owned, or when `operation` is `archive`. The resident enqueues an ADR-0460 Tier 0 `cross_check` with `DecisionPointSignal.kind: document_freshness`, the bundle reference, and the candidate; the question is fixed: "For each hunk, does the replacement follow from the cited evidence, and does the candidate change nothing else?" `agreement` marks the candidate `verified`. `material_disagreement` rejects it with `cross_check_disagreement` and the contested `hunkId`s; the stage regenerates once with the contested claims appended to the instructions; a second disagreement raises `document_freshness_blocked`. `unavailable` (no second provider, or Tier 0 budget exhausted) leaves the candidate `generated` and visible in `status` as `cross_check_unavailable`; it never applies.

## Authority and apply

Ownership resolution, in order: a `lervo_v1` managed block range is Lervo-managed; a path under `docs/knowledge/` or a role with `lifecycleOwner: lervo` or `rewritePolicy: lervo_exact` is Lervo-managed; everything else is user-owned, including `repository_tool` roles and documents without a role. A hunk is classified by the ownership of its byte range, so one candidate can carry both.

| Ownership     | Class               | Authority                                                                              |
| ------------- | ------------------- | -------------------------------------------------------------------------------------- |
| Lervo-managed | `factual_reference` | `none`: apply in the verifying cycle                                                   |
| Lervo-managed | `statement`         | `none`: apply in the verifying cycle                                                   |
| Lervo-managed | `safety_or_policy`  | `owner`                                                                                |
| User-owned    | `factual_reference` | `principal_mandate` when an installed mandate lists `document_freshness`; else `owner` |
| User-owned    | `statement`         | `owner`                                                                                |
| User-owned    | `safety_or_policy`  | `owner`                                                                                |

Apply is one transaction: re-run `source_hash`, write the output bytes, record `document.freshness.candidate.applied`, raise the informational attention item, and hand the path to the ADR-0434 settled-output commit with author `Lervo Knowledge` and trailer `Lervo-Freshness-Candidate: <candidateId>`. The commit selector treats a freshness apply over a committed pre-image exactly as an integrated canonical draft. A failed write restores the pre-image and records `rejected` with the write failure as `causeDigest`.

Owner approval binds `candidateId` and `afterHash`: `lervo knowledge freshness apply <candidateId> --approval <afterHash>`, or a natural-language reply in the escalation thread that the runtime translates to the same command. Proxy approval records `approvalSource: principal_mandate` and the mandate hash, counts against `maximumFreshnessApprovalsPerDay`, and is evaluated by the ADR-0453 policy before settlement; the proxy never settles a `statement` or `safety_or_policy` hunk.

Revert: `lervo knowledge freshness revert <candidateId>` restores `beforeBytesRef` when the current hash equals `afterHash`, records `reverted`, and writes a `freshnessHold { findingDigest, documentPath, until }` under `.lervo/state/knowledge/freshness-holds/`. A hash mismatch fails with `revert_conflict` and prints the three paths to reconcile by hand. Holds are also set by an owner rejection with `--reason not_stale`, which counts as a false positive.

## Surfaces

- `lervo knowledge freshness status [--root <path>] [--json]`: counts per state and priority class, the oldest open finding with its age, budget used today, the hold list, and the time-to-fresh of the last ten applies.
- `lervo knowledge freshness review [<candidateId>] [--json]`: without an identifier, lists candidates in `waiting_authority`; with one, prints each hunk as a unified diff followed by its claims and evidence coordinates, the check table, the cross-check outcome, and the exact apply command.
- `lervo knowledge freshness apply <candidateId> --approval <afterHash> [--reviewer <id>]`: owner apply; fails with `source_changed` or `freshness_hold_active`.
- `lervo knowledge freshness revert <candidateId>`: as above.
- Attention items: `document_freshness_candidate` (`actionOwner: user`, `requiresUserAction: true`, `blocking: false`, fields `candidateId`, `documentPath`, `priorityClass`, `changeClasses`, `hunkCount`, `instruction`); `document_freshness_applied` (`actionOwner: agent`, informational, fields `candidateId`, `documentPath`, `approvalSource`, `commitHash`, `revertInstruction`; resolves when acknowledged or after 24 hours); `document_freshness_blocked` (`actionOwner: user`, fields `reasonCode`, `documentPath` or null, `attempts`, `instruction`).
- Compact terminal context, one line at most 200 bytes, only when any count is non-zero: `Document freshness: 2 stale (1 safety: AGENTS.md), 1 candidate awaits review; lervo knowledge freshness review`.
- Turn report segment: `docs: 1 refreshed (README.md), 1 awaiting owner`.
- Discord: owner-authority candidates join the next ADR-0453 escalation batch as one item each with the one-line question "Apply freshness candidate `<id>` to `<path>` (`<classes>`)?" and the diff summary; applied notices join the same batch as `observe_only` lines.

## Events

All payloads carry relative paths, hashes, counts, codes, and identifiers only. Hunks, claims, evidence bodies, explanations, and before-bytes stay in CAS.

| Event                                   | Required fields                                                                                                                                                                                                       |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document.freshness.candidate.created`  | `candidateId`, `findingDigest`, `documentPath`, `documentHash`, `operation`, `priorityClass`, `changeClasses`, `hunkCount`, `evidenceCount`, `evidenceTruncated`, `tokensObserved`, `occurredAt`                      |
| `document.freshness.candidate.verified` | `candidateId`, `checks[]` (`code`, `status`), `crossCheck` (`not_required`, `agreement`, `material_disagreement`, `unavailable`), `deliberationRunId` or null, `authorityRequired`, `afterHash`, `occurredAt`         |
| `document.freshness.candidate.applied`  | `candidateId`, `documentPath`, `beforeHash`, `afterHash`, `appliedHunkCount`, `pendingHunkCount`, `approvalSource` (`lervo_managed`, `principal_mandate`, `owner`), `approvalRef`, `commitHash` or null, `occurredAt` |
| `document.freshness.candidate.rejected` | `candidateId`, `reasonCode`, `rejectorKind` (`deterministic`, `cross_check`, `proxy`, `owner`, `budget`), `contestedHunkIds[]`, `occurredAt`                                                                          |
| `document.freshness.candidate.reverted` | `candidateId`, `documentPath`, `restoredHash`, `revertedBy` (`owner`, `agent`), `holdUntil`, `occurredAt`                                                                                                             |
| `document.freshness.cycle.completed`    | `cycleId`, `findingCount`, `admittedCount`, `candidateCount`, `verifiedCount`, `appliedCount`, `skippedForBudget`, `skippedForHold`, `tokensObserved`, `occurredAt`                                                   |

Failure meaning: `claim_unbound`, `reference_unresolved`, `outside_bytes_changed`, and `cross_check_disagreement` reject the candidate and leave the document unchanged; `source_changed` supersedes it and a new candidate follows; `freshness_budget_exhausted` defers the finding to the next cycle with budget; `revert_conflict` leaves the document as found; `freshness_hold_active` refuses generation and apply until the hold ends. Five admitted findings with zero verified candidates in one day raise `document_freshness_blocked` with `reasonCode: zero_success_window`.

## Policy keys

Under `documentFreshness` in `.lervo/knowledge/policy.yaml`, all optional with these defaults: `enabled: true` (mirrors `features.document_freshness.enabled`), `safetyPatterns: [risk, limit, leverage, loss, credential, secret, deploy, production, live]`, `maximumCandidatesPerCycle: 3`, `maximumTokensPerCandidate: 30000`, `maximumTokensPerDay: 150000`, `maximumEditRatio: 0.25`, `maximumEditBytes: 4096`, `historicalRoot: docs/archive`, `holdDays: 7`, `crossCheck: required_for_consequential` (or `always`, `never` where `never` is refused for user-owned documents). The principal mandate key `maximumFreshnessApprovalsPerDay` defaults to 5.

## Fixtures and journey

Fixtures live beside the staleness fixtures in `packages/documents/test` and `packages/repository-knowledge-runtime/test`, with fixture providers under `scripts/distribution/fixtures`. Each fixture is a before tree, an after tree, a detection report, the expected candidate shape, and the expected events.

| Id  | Scenario (from Argo history)                                                                                                            | Expected                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | `AGENTS.md` says risk limits live in `v2/argo_v2/live/engine.py: Limits`; `v2/` deleted; `v4/argo4/live/engine.py` holds `class Limits` | `safety`, two hunks, `safety_or_policy`, cross-check `agreement`, `authorityRequired: owner`, candidate in the first cycle                  |
| F2  | `README.md` links `v2/README.md` (missing) and says "every 6 hours"; `v4/README.md` says "daily at 00:40 UTC"                           | `entrypoint`, `factual_reference`, `principal_mandate` when a mandate lists the kind, else `owner`; `references_resolve` passes after apply |
| F3  | Root `FINAL-DESIGN.md` describes removed v1; `IMPLEMENTATION-HANDOFF*` deleted; nine inbound links                                      | `archive` to `docs/archive/v1-final-design.md` with banner and nine `inboundLinkRewrites`; `owner`                                          |
| F4  | Unrelated edit under `v3/scripts`; a document already correct but flagged by `review_interval_elapsed`                                  | no candidate; `no_change_needed` counted as a false positive                                                                                |
| F5  | Owner edits the document while a candidate waits                                                                                        | `source_changed`, state `superseded`, new candidate next cycle                                                                              |
| F6  | Apply F2 then revert                                                                                                                    | hash restored, `reverted`, hold set, no candidate for seven days                                                                            |
| F7  | `AGENTS.md` hunk inside a `lervo_v1` block plus one in user prose                                                                       | `partially_applied`; managed hunk applied through the ADR-0022 patch; user hunk waits                                                       |

Installed journey (`installed-document-freshness-v1`): on a scratch repository with the knowledge resident running, rename a referenced path and commit; assert a finding within one change-driven cycle, a `verified` candidate within budget, an owner or proxy approval, an applied commit with the trailer, and `status` showing the time to fresh. Evidence document under `docs/evidence/quality/`.

## Metrics

Computed weekly from the events above and reported beside the ADR-0459 projections: time to fresh (`detectedAt` to `applied`, per `priorityClass`, median and p90), time to candidate (`detectedAt` to `verified`), false-positive rate (`no_change_needed` plus owner `not_stale` rejections over candidates), acceptance rate (`applied` over `verified`), tokens per applied update, revert rate, and cross-check disagreement rate. Targets are in ADR-0463.

## References

- [ADR-0023 evidence-based document staleness](../../decisions/knowledge/documents/0023-evidence-based-document-staleness.md)
- [ADR-0022 byte-preserving managed-block patch candidates](../../decisions/knowledge/documents/0022-byte-preserving-managed-block-patch-candidate.md)
- [ADR-0206 public README preservation](../../decisions/knowledge/documents/0206-public-readme-preservation-and-improvement.md)
- [Background knowledge convergence runtime](../../specs/background-knowledge-convergence/runtime.md)
- [Operating attention](../execution/operating-attention.md)
- [Open collaboration platform roadmap](../../roadmap/open-collaboration-platform.md)
