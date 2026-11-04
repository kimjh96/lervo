# Document freshness operations and validation

## Authority and apply

A tool-generated document never becomes a finding, so it never receives a candidate ([ADR-0473](../../../decisions/knowledge/documents/0473-publish-knowledge-within-its-write-scope-and-never-rewrite-a-tool-generated-document.md)). Its repository tool owns its bytes.

Resolve ownership of every other document in this order:

1. A range inside one `lervo_v1` managed block's content is Lervo-managed.
2. A path under the publication root (`docs/knowledge/` by default), or a layout role with `lifecycleOwner: lervo` or `rewritePolicy: lervo_exact`, is Lervo-managed.
3. Everything else is user-owned, including `repository_tool` roles and documents without a role.

Classify each hunk by its byte range's ownership; candidates can mix ownership. A range touching a marker fails `commonmark_structure`.

| Ownership | Class | Authority | Effect |
| --- | --- | --- | --- |
| Lervo-managed | `factual_reference` | `none`: apply in verifying cycle | applies |
| Lervo-managed | `statement` | `none`: apply in verifying cycle | applies after Tier 0 agreement; owner when Tier 0 is unavailable |
| Lervo-managed | `safety_or_policy` | `owner` | owner |
| User-owned | `factual_reference` | `principal_mandate` if an installed mandate lists `document_freshness`; otherwise `owner` | owner; no mandate kind is installed |
| User-owned | `statement` | `owner` | owner |
| User-owned | `safety_or_policy` | `owner` | owner |

Tier 0 agreement ([ADR-0557](../../../decisions/knowledge/documents/freshness/0557-cross-check-freshness-candidates-in-an-independent-no-capability-session.md)) grants no authority. It only removes the owner substitution for hunks this matrix already lets Lervo apply. Every user-owned hunk still needs its listed authority.

Apply runs as one sequence under the knowledge worker's repository lock:

1. Re-check bytes against the expected hash (`appliedHash` after partial apply, otherwise `sourceHash`) and require the first apply to start from committed bytes.
2. Store before-bytes in CAS and write output atomically.
3. Commit only touched paths as `Lervo Knowledge`, with trailer `Lervo-Freshness-Candidate: <candidateId>`.
4. Update the candidate and record `document.freshness.candidate.applied`.

When every newly applied hunk sits in a managed block, produce output through the ADR-0022 managed-block patch; it must equal the verified hunk output. Changed source supersedes the candidate with `source_changed`. Failed writes restore the pre-image and record `rejected` with `write_failed`. Unsafe or contended commits leave written bytes and record `commitHash: null`.

Owner approval binds `candidateId` and `afterHash`: `lervo knowledge freshness apply <candidateId> --approval <afterHash>`. It applies all pending hunks or the archive. `approval_mismatch`, `source_changed`, or `freshness_hold_active` fail without writing. Proxy approval would record `approvalSource: principal_mandate` and the mandate hash; version 1 has no proxy path.

`lervo knowledge freshness revert <candidateId>` restores `beforeBytesRef` only when current hash equals `appliedHash`, commits with `Lervo-Freshness-Revert: <candidateId>`, records `reverted`, and writes a hold `{ findingDigest, documentPath, candidateId, reason: reverted, until }`. Hash mismatch fails with `revert_conflict` and names three coordinates for manual reconciliation. Archive revert restores the source and all rewritten inbound documents from the CAS pre-image.

`lervo knowledge freshness reject <candidateId> --reason not_stale` sets the same hold and counts as a false positive. `--reason incorrect` only closes the candidate.

## Surfaces

- `lervo knowledge freshness status [--root <path>] [--json]`: counts by state and priority class, oldest open candidate and age, today's budget used, hold list, and time-to-fresh of the last ten applies.
- `lervo knowledge freshness review [<candidateId>] [--json]`: without an identifier, lists candidates awaiting the owner with exact apply commands and any `unavailable` cross-check reason; with one, prints each hunk as a unified diff with its cross-check verdict and reason, claims and evidence coordinates, the check table, and the cross-check outcome, reviewer, and run.
- `lervo knowledge freshness apply|revert|reject|acknowledge <candidateId>`: operations above; `acknowledge` resolves an applied notice.

Attention items appear in `lervo application attention` and the cached retrieval prompt path under the [operating attention report contract](../../execution/operating-attention/report-contract.md#document-freshness):

| Item | Ownership and behavior | Fields |
| --- | --- | --- |
| `document_freshness_candidate` | A verified held candidate is attributed to the resident freshness cycle unless pending hunks concern user-owned bytes, owner-authorized writes, or safety/policy. Only those consequential effects require user action; `blocking: false`. | `candidateId`, `documentPath`, `priorityClass`, `changeClasses`, `hunkCount`, `instruction` |
| `document_freshness_applied` | `actionOwner: agent`, informational; resolves on acknowledgment or after 24 hours | `candidateId`, `documentPath`, `approvalSource`, `commitHash`, `revertInstruction` |
| `document_freshness_blocked` | Reports the failed-attempt or repeated-disagreement condition. Its reason code alone does not establish a structured consequential effect requiring user action. | `reasonCode` (`zero_success_window` or `repeated_cross_check_disagreement`), `documentPath` or null, `attempts`, `instruction` |

None is blocking. The application report returns at most 256 records, with classification and totals covering every loaded freshness candidate before that cap. Omitted candidates remain inspectable through `lervo knowledge freshness review <candidate-id>` and `lervo knowledge freshness status`.

The compact prompt reads the shared health projection instead of rendering a direct freshness-review preamble. The report contract does not establish an exact actor for blocked items or current compact byte and item limits; those details remain unverified here. The application report cap is not a compact-prompt limit. Attention attribution does not change the approval requirements in Authority and apply.

`documentFreshnessTurnReportSegment` renders `docs: 1 refreshed (README.md), 1 awaiting owner`. No host renders an ADR-0459 turn report yet, so this segment has no consumer.

`documentFreshnessEscalationQuestion` renders "Apply freshness candidate `<id>` to `<path>` (`<classes>`)?" `documentFreshnessApprovalFromReply` translates owner replies into exact apply commands. An explicit candidate identifier always wins; a bare affirmative binds only when exactly one candidate waits. Neither has a consumer because the ADR-0453 escalation batch does not yet exist.

## Events

Payloads contain only relative paths, hashes, counts, codes, and identifiers. Hunks, claims, evidence bodies, explanations, and before-bytes stay in CAS and the candidate store. Events exist in event schema 4. Older repository writers cannot record them: the stage reports `unavailable`, and the CLI refuses owner operations. `usageObserved` is total provider token count; its name omits "token" because event redaction drops every key containing that word.

| Event | Required fields |
| --- | --- |
| `document.freshness.candidate.created` | `candidateId`, `findingDigest`, `documentPath`, `documentHash`, `operation`, `priorityClass`, `changeClasses`, `hunkCount`, `evidenceCount`, `evidenceTruncated`, `usageObserved`, `occurredAt` |
| `document.freshness.candidate.verified` | `candidateId`, `checks[]` (`code`, `status`), `crossCheck` (`not_required`, `agreement`, `material_disagreement`, `unavailable`), `deliberationRunId` (the Tier 0 call's `run_freshness_<24 hex>` run) or null when no call reached a provider, `authorityRequired`, `afterHash`, `occurredAt`. Recorded once, after any required cross-check settles. |
| `document.freshness.candidate.applied` | `candidateId`, `documentPath`, `beforeHash`, `afterHash`, `appliedHunkCount`, `pendingHunkCount`, `approvalSource` (`lervo_managed`, `principal_mandate`, `owner`), `approvalRef`, `commitHash` or null, `occurredAt` |
| `document.freshness.candidate.rejected` | `candidateId`, `reasonCode`, `rejectorKind` (`deterministic`, `cross_check`, `proxy`, `owner`, `budget`), `contestedHunkIds[]`, `occurredAt` |
| `document.freshness.candidate.reverted` | `candidateId`, `documentPath`, `restoredHash`, `revertedBy` (`owner`, `agent`), `holdUntil`, `occurredAt` |
| `document.freshness.cycle.completed` | `cycleId` (`kfcy_` plus 24 hex), `findingCount`, `admittedCount`, `candidateCount`, `verifiedCount`, `appliedCount`, `skippedForBudget`, `skippedForHold`, `usageObserved`, `occurredAt` |

Failure behavior:

- `claim_unbound`, `reference_unresolved`, `outside_bytes_changed`, `candidate_invalid`, and `cross_check_disagreement`: reject the candidate; leave the document unchanged.
- `source_changed`: supersede the candidate; a new candidate follows after the edit is committed.
- `freshness_budget_exhausted`: reject an over-budget call or defer the finding to a cycle with budget.
- `write_failed`: restore the pre-image.
- `owner_rejected`: close the candidate.
- `revert_conflict`: leave the document as found.
- `freshness_hold_active`: refuse apply until the hold ends.

Five attempts with zero verified candidates in one day raise `document_freshness_blocked` with `reasonCode: zero_success_window`. A finding whose candidate and single regeneration both met Tier 0 disagreement raises it with `reasonCode: repeated_cross_check_disagreement` until a later candidate exists for that document.

A Tier 0 failure never blocks other work: it settles the candidate as `unavailable` with its reason and holds it for the owner.

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

`crossCheck` also accepts `always` or `never`; `never` is refused for user-owned bytes. Unknown keys or out-of-bound values fail policy validation. The principal mandate key `maximumFreshnessApprovalsPerDay` (default 5) waits for the mandate kind.

## Fixtures and journey

Domain cases: `packages/repository-knowledge/test/document-freshness.test.ts` and `document-freshness-cross-check.test.ts`. Argo fixtures: `packages/repository-knowledge-runtime/test/document-freshness-fixtures.test.ts`, running the real stage against scratch Git repositories; Tier 0 journeys: `document-freshness-cross-check.test.ts` beside it. The fixture provider, `scripts/distribution/fixtures/document-freshness-claude.mjs`, answers the no-capability JSON contract, including the cross-check task, from a plan file beside it.

| Id | Scenario from Argo history | Expected in version 1 |
| --- | --- | --- |
| F1 | `AGENTS.md` says risk limits live in `v2/argo_v2/live/engine.py: Limits`; `v2/` deleted; `v4/argo4/live/engine.py` holds `class Limits` | `safety`, two `safety_or_policy` hunks, `crossCheck: agreement`, `authorityRequired: owner`, `waiting_authority`, two usage records (generation and cross-check), first cycle |
| F2 | `README.md` links missing `v2/README.md` and says "every 6 hours"; `v4/README.md` says "daily at 00:40 UTC" | `entrypoint`, two `factual_reference` user-owned hunks, `crossCheck: agreement`, `owner` (no mandate kind), `references_resolve` passes |
| F3 | Root `FINAL-DESIGN.md` describes removed v1; `IMPLEMENTATION-HANDOFF.md` deleted; nine inbound links | `archive` to `docs/archive/v1-final-design.md` with banner and nine `inboundLinkRewrites`; `owner`; owner apply moves it and commits with the trailer |
| F4 | Unrelated edit under `v3/scripts`; already-correct document flagged by `review_interval_elapsed` | No candidate for the edit; deterministic `no_change_needed` without provider call |
| F5 | Owner edits document while candidate waits | `source_changed`, state `superseded`, new candidate after edit is committed |
| F6 | Apply F2, then revert | Approval mismatch refused; owner apply commits as `Lervo Knowledge`; revert restores bytes; `reverted`; hold set; no candidate next day |
| F7 | `AGENTS.md` hunk inside a `lervo_v1` block plus one in user prose | `partially_applied`; managed hunk applied through ADR-0022 patch and committed; user hunk waits; owner apply completes it |

Installed journey (`installed-document-freshness-v1`): on a copy of the Lervo repository with the knowledge resident's freshness stage, rename a referenced path and commit. Assert a finding within one change-driven cycle, a Lervo-managed hunk applied and committed with the trailer, a user-owned candidate awaiting the owner, and `status` showing time to fresh. The first local run uses the fixture provider. A real-provider run and an evidence document under `docs/evidence/quality/` remain open.

## Metrics

Compute weekly from these events and report beside ADR-0459 projections:

- Time to fresh: `detectedAt` to `applied`, median and p90 per `priorityClass`.
- Time to candidate: `detectedAt` to `verified`.
- False-positive rate: `no_change_needed` plus owner `not_stale` rejections over candidates.
- Acceptance rate: `applied` over `verified`.
- Tokens per applied update, revert rate, and cross-check disagreement rate.

Targets are in ADR-0463. The weekly projection is not built yet; `lervo knowledge freshness status` reports time to fresh per apply.
