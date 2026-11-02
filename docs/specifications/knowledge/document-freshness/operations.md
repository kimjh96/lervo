# Document freshness operations and validation

## Authority and apply

A tool-generated document never becomes a finding, so it never receives a candidate ([ADR-0473](../../../decisions/knowledge/documents/0473-publish-knowledge-within-its-write-scope-and-never-rewrite-a-tool-generated-document.md)). Its repository tool owns its bytes.

Resolve ownership of every other document in this order:

1. A range inside one `lervo_v1` managed block's content is Lervo-managed.
2. A path under the publication root (`docs/knowledge/` by default), or a layout role with `lifecycleOwner: lervo` or `rewritePolicy: lervo_exact`, is Lervo-managed.
3. Everything else is user-owned, including `repository_tool` roles and documents without a role.

Classify each hunk by its byte range's ownership; candidates can mix ownership. A range touching a marker fails `commonmark_structure`.

Under [ADR-0561](../../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), no hunk or archive needs owner or mandate authority. Lervo applies a change once its required independent cross-checks agree:

| Ownership | `factual_reference` | `statement` | `safety_or_policy` | `archive` |
| --- | --- | --- | --- | --- |
| Lervo-managed | applies without a cross-check | one agreeing check | two agreeing checks | two agreeing checks |
| User-owned | one agreeing check | two agreeing checks | two agreeing checks | two agreeing checks |

The [candidate contract](candidates.md#cross-check) defines the rounds, the second-round provider preference, and the outcomes. The ADR-0463 authority matrix, the owner substitution for an unavailable cross-check, and the `document_freshness` mandate path are superseded.

Apply runs as one sequence under the knowledge worker's repository lock:

1. Re-check bytes against the expected hash (`appliedHash` after partial apply, otherwise `sourceHash`) and require the first apply to start from committed bytes. An archive re-checks the source, every rewritten inbound document, and the free target.
2. Store before-bytes (or the archive pre-image) in CAS and write output atomically.
3. Commit only touched paths as `Lervo Knowledge`, with trailers `Lervo-Freshness-Candidate: <candidateId>`, `Lervo-Freshness-Reason: <finding reasons>`, and `Lervo-Freshness-Cross-Check: <verdict>`, for example `agreement 2/2 (claude run_freshness_…; codex run_freshness_…)`.
4. Update the candidate with `approval: { approvalSource: lervo_managed, approvalRef, reviewer: "cross_check <run IDs>" }` and record `document.freshness.candidate.applied`.

When every newly applied hunk sits in a managed block, produce output through the ADR-0022 managed-block patch; it must equal the verified hunk output. Changed source supersedes the candidate with `source_changed`. Failed writes restore the pre-image and record `rejected` with `write_failed`. Unsafe or contended commits leave written bytes and record `commitHash: null`.

Each apply reaches the owner after the fact as an [ADR-0549](../../../decisions/execution/applications/0549-tell-the-owner-what-lervo-learned-after-development.md) notice read from those trailers: `refreshed <path> (reason <reasons>; cross-check <verdict>; undo: lervo knowledge freshness revert <candidateId>)`, or `archived <path> (…)`. The notice is information; nothing waits for it.

`lervo knowledge freshness revert <candidateId>` restores `beforeBytesRef` only when current hash equals `appliedHash`, commits with `Lervo-Freshness-Revert: <candidateId>`, records `reverted`, and writes a hold `{ findingDigest, documentPath, candidateId, reason: reverted, until }`. Hash mismatch fails with `revert_conflict` and names three coordinates for manual reconciliation. Archive revert restores the source and all rewritten inbound documents from the CAS pre-image.

`lervo knowledge freshness apply` and `lervo knowledge freshness reject` were removed by ADR-0561. Both fail with a message that names the revert command; revert is the owner's undo.

## Lervo debt

What Lervo cannot resolve itself is its own debt, held with backoff and shown in health with its age and reason; it is never owner work. The cycle record keeps the projection under `debt` (at most 512 entries), each `{ findingDigest, documentPath, candidateId, reason, since, attempts, retryAt }`:

| Reason | Enters debt when |
| --- | --- |
| `cross_check_disagreement_repeated` | The candidate and its single regeneration were both rejected by cross-check disagreement or an undetermined value, and the latest was a disagreement. |
| `freshness_evidence_undetermined` | The same, and the latest answer was `needs_owner_input` after evidence recovery. |
| `budget_exceeded` | The latest candidate exhausted its token budget. |

The first hold lasts one day and each failed retry doubles it, up to sixteen days. When it elapses, admission allows one more attempt even though the finding's attempts were exhausted; that attempt carries the latest failure as regeneration evidence. A retry rejected for another reason keeps the debt. An applied, verified, reverted, or superseded latest candidate clears it.

Five attempts with zero verified candidates in one day put generation on a zero-success hold (`zeroSuccessHold: { since, until, level }` in the cycle record): one hour, doubled for each consecutive hold, at most one day. Held cross-checks still run. The hold clears once a candidate verifies or the daily budget resets.

## Surfaces

- `lervo knowledge freshness status [--root <path>] [--json]`: counts by state and priority class, oldest open candidate and age, today's budget used, hold list, and time-to-fresh of the last ten applies.
- `lervo knowledge freshness review [<candidateId>] [--json]`: without an identifier, lists candidates Lervo holds, with any `unavailable` cross-check reason and the retry time; with one, prints each hunk as a unified diff with its cross-check verdict and reason, claims and evidence coordinates, the check table, the cross-check outcome, earlier agreeing rounds, reviewer, and run, and the undo command once applied. Review is inspection only.
- `lervo knowledge freshness revert|acknowledge <candidateId>`: operations above; `acknowledge` resolves an applied notice.

`status` also lists Lervo debt with reason, age, attempts, and retry time, and the active zero-success hold.

Attention items appear in `lervo application attention` and the cached retrieval prompt path under the [operating attention report contract](../../execution/operating-attention/report-contract.md#document-freshness). None requires user action or blocks (ADR-0561):

| Item | Ownership and behavior | Fields |
| --- | --- | --- |
| `document_freshness_candidate` | `state: lervo_debt`, host resident; a held candidate waiting for its retried cross-check | `candidateId`, `documentPath`, `priorityClass`, `changeClasses`, `hunkCount`, `heldReason`, `retryAt`, `instruction` |
| `document_freshness_applied` | `actionOwner: agent`, informational; resolves on acknowledgment or after 24 hours | `candidateId`, `documentPath`, `approvalSource`, `commitHash`, `revertInstruction`; the instruction names the reason and the cross-check verdict |
| `document_freshness_blocked` | `state: lervo_debt`, host resident | `reasonCode` (`zero_success_window`, `cross_check_disagreement_repeated`, `freshness_evidence_undetermined`, or `budget_exceeded`), `documentPath` or null, `attempts`, `since`, `retryAt`, `instruction` |

The application report returns at most 256 records, with classification and totals covering every loaded freshness candidate before that cap. Omitted candidates remain inspectable through `lervo knowledge freshness review <candidate-id>` and `lervo knowledge freshness status`. Repository health adds a Lervo debt line with the count, the oldest entry's age, path, and reason.

The compact prompt reads the shared health projection. `documentFreshnessCompactLine` renders one line of at most 200 bytes only when any count is non-zero, for example `Document freshness (no owner action): 2 stale (1 safety: AGENTS.md), 1 candidate held by Lervo, 1 Lervo debt; lervo knowledge freshness status`.

`documentFreshnessTurnReportSegment` renders `docs: 1 refreshed (README.md), 1 held by Lervo`. No host renders an ADR-0459 turn report yet, so this segment has no consumer. The escalation question and the owner-reply parser were removed with the owner apply path.

## Events

Payloads contain only relative paths, hashes, counts, codes, and identifiers. Hunks, claims, evidence bodies, explanations, and before-bytes stay in CAS and the candidate store. Events exist in event schema 4. Older repository writers cannot record them: the stage reports `unavailable`, and the CLI refuses revert and acknowledge. `usageObserved` is total provider token count; its name omits "token" because event redaction drops every key containing that word.

| Event | Required fields |
| --- | --- |
| `document.freshness.candidate.created` | `candidateId`, `findingDigest`, `documentPath`, `documentHash`, `operation`, `priorityClass`, `changeClasses`, `hunkCount`, `evidenceCount`, `evidenceTruncated`, `usageObserved`, `occurredAt` |
| `document.freshness.candidate.verified` | `candidateId`, `checks[]` (`code`, `status`), `crossCheck` (`not_required`, `agreement`, `material_disagreement`, `unavailable`), `deliberationRunId` (the latest Tier 0 round's `run_freshness_<24 hex>` run) or null when no call reached a provider, `authorityRequired` (`none` since ADR-0561), `afterHash`, `occurredAt`. Recorded when the required cross-check settles with agreement or as unavailable, and again for each retried settlement. |
| `document.freshness.candidate.applied` | `candidateId`, `documentPath`, `beforeHash`, `afterHash`, `appliedHunkCount`, `pendingHunkCount`, `approvalSource` (`lervo_managed` since ADR-0561; `principal_mandate` and `owner` remain readable), `approvalRef`, `commitHash` or null, `occurredAt` |
| `document.freshness.candidate.rejected` | `candidateId`, `reasonCode`, `rejectorKind` (`deterministic`, `cross_check`, `proxy`, `owner`, `budget`), `contestedHunkIds[]`, `occurredAt` |
| `document.freshness.candidate.reverted` | `candidateId`, `documentPath`, `restoredHash`, `revertedBy` (`owner`, `agent`), `holdUntil`, `occurredAt` |
| `document.freshness.cycle.completed` | `cycleId` (`kfcy_` plus 24 hex), `findingCount`, `admittedCount`, `candidateCount`, `verifiedCount`, `appliedCount`, `skippedForBudget`, `skippedForHold`, `usageObserved`, `occurredAt` |

Failure behavior:

- `claim_unbound`, `reference_unresolved`, `outside_bytes_changed`, `candidate_invalid`, and `cross_check_disagreement`: reject the candidate; leave the document unchanged.
- `source_changed`: supersede the candidate; a new candidate follows after the edit is committed.
- `freshness_budget_exhausted`: reject an over-budget call or defer the finding to a cycle with budget; a rejected candidate becomes Lervo debt.
- `write_failed`: restore the pre-image.
- `owner_rejected`: readable on older records; no command produces it since ADR-0561.
- `revert_conflict`: leave the document as found.
- `freshness_hold_active`: readable on older records; admission skips held findings.

Repeated cross-check disagreement, an undetermined value after recovery, and an exhausted budget become [Lervo debt](#lervo-debt); five attempts without a verified candidate start the zero-success hold. A Tier 0 failure never blocks other work: it settles the candidate as `unavailable` with its reason, and Lervo retries it with backoff.

A provider failure before any model call (the version check, the no-capability probe, or admission under [ADR-0536](../../../decisions/execution/providers/admission/0536-admit-provider-clis-by-contract.md)) defers the finding with `provider_not_admitted`. It spends no budget, creates no rejected candidate, and does not count as an attempt. Only a call that reached the model can be charged at the per-candidate bound when its usage is unobserved. On 2026-10-31, a Codex probe rejection had recorded 14 `candidate_invalid` rejections since 2026-10-29 and exhausted the daily budget with no model call.

## Policy keys

All keys under `documentFreshness` in `.lervo/knowledge/policy.yaml` are optional, with these defaults:

| Key | Default |
| --- | --- |
| `enabled` | `true` |
| `safetyPatterns` | `[risk, limit, leverage, loss, credential, secret, deploy, production, live]` |
| `maximumCandidatesPerCycle` | `3` |
| `maximumTokensPerCandidate` | `30000` |
| `maximumTokensPerDay` | `150000` |
| `maximumEditRatio` | `0.25` |
| `maximumEditBytes` | `4096` |
| `historicalRoot` | `docs/archive` |
| `holdDays` | `7` |
| `crossCheck` | `required_for_consequential` |

`crossCheck` also accepts `always` or `never`; `never` is refused for user-owned bytes. Unknown keys or out-of-bound values fail policy validation. The principal mandate key `maximumFreshnessApprovalsPerDay` has no effect since ADR-0561.

## Fixtures and journey

Domain cases: `packages/repository-knowledge/test/document-freshness.test.ts` and `document-freshness-cross-check.test.ts`. Argo fixtures: `packages/repository-knowledge-runtime/test/document-freshness-fixtures.test.ts`, running the real stage against scratch Git repositories; Tier 0 journeys: `document-freshness-cross-check.test.ts` beside it. The fixture provider, `scripts/distribution/fixtures/document-freshness-claude.mjs`, answers the no-capability JSON contract, including the cross-check task, from a plan file beside it.

| Id | Scenario from Argo history | Expected since ADR-0561 |
| --- | --- | --- |
| F1 | `AGENTS.md` says risk limits live in `v2/argo_v2/live/engine.py: Limits`; `v2/` deleted; `v4/argo4/live/engine.py` holds `class Limits` | `safety`, two `safety_or_policy` hunks, two agreeing rounds in separate runs, `applied` by Lervo in the first cycle, three usage records (generation and two cross-checks) |
| F2 | `README.md` links missing `v2/README.md` and says "every 6 hours"; `v4/README.md` says "daily at 00:40 UTC" | `entrypoint`, two `factual_reference` user-owned hunks, one agreeing check, `applied`; `references_resolve` passes |
| F3 | Root `FINAL-DESIGN.md` describes removed v1; `IMPLEMENTATION-HANDOFF.md` deleted; nine inbound links | `archive` to `docs/archive/v1-final-design.md` with banner and nine `inboundLinkRewrites`; two agreeing rounds; Lervo moves it and commits with the trailers. A second scenario disagrees in one round twice and leaves the document in place as Lervo debt. |
| F4 | Unrelated edit under `v3/scripts`; already-correct document flagged by `review_interval_elapsed` | No candidate for the edit; deterministic `no_change_needed` without provider call |
| F5 | Owner edits document while a candidate is held for its retried cross-check | `source_changed`, state `superseded`, new candidate after edit is committed |
| F6 | Lervo applies F2, then the owner reverts | Revert restores bytes; `reverted`; hold set; no candidate next day |
| F7 | `AGENTS.md` hunk inside a `lervo_v1` block plus one in user prose | Both apply together: the managed hunk through the ADR-0022 patch without a cross-check, the user prose hunk after one agreeing check |

`document-freshness-autonomy.test.ts` beside the fixtures covers a user-owned `statement` hunk after two agreeing checks, one agreement and one disagreement regenerating once with the reasons and then holding as debt, and `needs_owner_input` recovering or becoming debt.

Installed journey (`installed-document-freshness-v1`): on a copy of the Lervo repository with the knowledge resident's freshness stage, rename a referenced path and commit. Assert a finding within one change-driven cycle, the cross-checked change applied and committed with the trailers, the ADR-0549 notice naming the revert command, and `status` showing time to fresh. The first local run uses the fixture provider and predates ADR-0561. A real-provider run and an evidence document under `docs/evidence/quality/` remain open.

## Metrics

Compute weekly from these events and report beside ADR-0459 projections:

- Time to fresh: `detectedAt` to `applied`, median and p90 per `priorityClass`.
- Time to candidate: `detectedAt` to `verified`.
- False-positive rate: `no_change_needed` plus owner reverts over candidates.
- Acceptance rate: `applied` over `verified`.
- Tokens per applied update, revert rate, and cross-check disagreement rate.

Targets are in ADR-0463. The weekly projection is not built yet; `lervo knowledge freshness status` reports time to fresh per apply.
