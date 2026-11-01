# ADR-0557: Cross-check freshness candidates in an independent no-capability session

Status: `accepted`
Decision date: 2026-11-02
Amends: [ADR-0463 document freshness](../0463-refresh-stale-documents-with-evidence-bound-minimal-edits.md) (Tier 0 for freshness)
Related: [ADR-0460 tiered deliberation](../../../coordination/deliberation/0460-trigger-tiered-deliberation-at-decision-points.md), [ADR-0536 provider admission](../../../execution/providers/admission/0536-admit-provider-clis-by-contract.md)
Contract: [Document freshness candidates](../../../../specifications/knowledge/document-freshness/candidates.md#cross-check), [operations](../../../../specifications/knowledge/document-freshness/operations.md#authority-and-apply)

## Context

ADR-0463 requires a Tier 0 cross-check for consequential freshness hunks: `statement` and `safety_or_policy` hunks, user-owned bytes, and archives. Until ADR-0460 Slice 1 shipped Tier 0, version 1 recorded `crossCheck: unavailable` and sent every such candidate to the owner. A Lervo-managed `statement` hunk, which the authority matrix lets Lervo apply, therefore waited for the owner too.

ADR-0460 Slice 1 still has no runtime. The owner chose to cross-check freshness candidates in a separate Claude session. A second provider is not usable: Codex 0.166 always exposes `exec`, `wait`, `request_user_input`, and `spawn_agent`, so ADR-0536 admission rejects it with `capabilities_exposed`.

## Decision

Tier 0 for document freshness is one call in a fresh no-capability session of an admitted provider. It is never the generation session and shares no conversation with it. The intended reviewer is a different admitted provider. Today no second provider passes no-capability admission, so this version calls the provider that the resident's admission selects, in a separate process. For Claude, that process runs with `--no-session-persistence`. The call goes through the same adapter, delegation, host admission, provider pause, and ADR-0459 usage record as generation. The candidate records which provider reviewed it.

### Question, input, and output

The fixed question is: "For each hunk, does the replacement follow from the cited evidence, and does the candidate change nothing else?"

The reviewer receives, for each hunk of an `edit` candidate: the exact source bytes it replaces, the replacement, up to three lines of context on each side, the change class, and the claims with their evidence coordinates. It also receives the excerpts of the cited bundle evidence, at most 6 KiB each and 24 KiB in total. The input goes to CAS before the call; only its hash is recorded on the candidate.

The response must be strict JSON: `{ hunks: [{ hunkId, verdict: agree | disagree, reason }] }`, with exactly one verdict per candidate hunk and a reason of 1 to 400 characters. Unknown, missing, or duplicate hunk IDs, extra keys, or other shapes make the response invalid. An invalid response is `unavailable`, never agreement.

### Outcomes

| Outcome                                      | Candidate effect                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agreement`: every hunk `agree`              | The cross-check substitution is removed. Lervo-managed hunks that need no other authority apply in the settling cycle. User-owned hunks still need `owner`, or `principal_mandate` where the ADR-0463 matrix allows it. `safety_or_policy` hunks still need `owner`. State is `verified` when Lervo can apply something, otherwise `waiting_authority`. |
| `material_disagreement`: any hunk `disagree` | The whole candidate is `rejected` with `cross_check_disagreement`, `rejectorKind: cross_check`, and the contested hunk IDs. It never reaches the owner queue. The finding regenerates once in a later cycle. A second disagreement for the same finding raises `document_freshness_blocked` with `reasonCode: repeated_cross_check_disagreement`.       |
| `unavailable`                                | Today's behavior: the candidate waits in `verified_pending_cross_check`, and owner approval substitutes for the cross-check. The candidate records why.                                                                                                                                                                                                 |

`unavailable` reasons are `freshness_budget_exhausted`, `knowledge_authority_unavailable`, `knowledge_capacity_unavailable`, `knowledge_provider_paused`, `provider_not_admitted`, `cross_check_input_unavailable`, `cross_check_provider_failed`, `cross_check_usage_unavailable`, `cross_check_response_invalid`, and `archive_not_cross_checked`. None blocks other freshness work.

Archives are not cross-checked in this version, because the question is per hunk. They record `archive_not_cross_checked` and keep the owner path.

### Pending calls

While the call is unsettled, the candidate stays `generated` with `crossCheckReview.status: pending`. It is not in the owner queue, Lervo applies nothing from it, and no `verified` event exists yet. The resident allows one provider call per turn, so the generation turn usually defers the cross-check. The next freshness cycle resumes it before any new generation. Eight turns without provider capacity settle it as `unavailable` with `knowledge_capacity_unavailable`. A turn that has no capacity counts one deferral for every pending candidate it could not reach, so later candidates reach the same bound. Changed source bytes or dependencies supersede a pending candidate, as they supersede any open candidate.

### Budget

Cross-check tokens count inside the 30,000-token candidate budget and the daily repository budget. Before the call, an estimate of the stored input at four bytes per token must fit in the remaining candidate budget. After the call, the observed usage must fit too. Otherwise the outcome is `unavailable` with `freshness_budget_exhausted`. A failed call, one with unobserved usage, or one that reached the provider and then reported a quota or authentication failure is charged the remaining candidate budget, because it may have reached the model. A resumed call is also bounded by what remains of the daily budget; when the daily budget cannot afford it, the candidate stays pending without spending or counting a deferral, until the budget resets. Settled cross-check spend is written to the cycle state before any later step of the cycle, so a later failure cannot make it reusable.

### Authority that remains

Generation, verification, and the cross-check need no authority. Agreement grants no authority. It only removes the owner substitution for hunks the matrix already lets Lervo apply. Writing user-owned bytes remains a consequential effect that needs the owner. Safety and policy hunks need the owner in every ownership.

## Events, states, privacy, and failure meaning

- `document.freshness.candidate.verified` is recorded once, when the cross-check settles with `agreement` or `unavailable`. `crossCheck` carries the outcome. `deliberationRunId` carries the call's ADR-0459 run identifier (`run_freshness_<24 hex>`), or null when no call reached a provider. The existing event schema already allows both fields, so no schema change is needed.
- `document.freshness.candidate.rejected` carries `cross_check_disagreement`, `rejectorKind: cross_check`, and the contested hunk IDs.
- The candidate gains the additive field `crossCheckReview`: `status`, `inputHash`, `runId`, `reviewerProvider`, `outcome`, `unavailableReason`, per-hunk `verdicts`, `tokensObserved`, `deferrals`, and `settledAt`. Older candidates have no such field.
- `DocumentFreshnessBlockedAttentionItemV1.reasonCode` gains `repeated_cross_check_disagreement`, with the document path and attempt count.
- Prompts, inputs, and reviewer reasons never enter events. Reasons stay in the rebuildable candidate store, and `lervo knowledge freshness review` shows them per hunk.

## Verification

Focused tests use the fixture provider, with provider discovery confined to the test home. They show:

- agreement on a Lervo-managed `statement` hunk applies it without the owner;
- after agreement, a user-owned hunk still waits for the owner;
- disagreement rejects with the contested hunk IDs, stays out of the owner queue, and regenerates once; a second disagreement raises the blocked item;
- invalid JSON and a failed call both settle as `unavailable` and never as agreement;
- cross-check tokens count in the candidate and daily budgets, and an over-budget call settles as `unavailable`;
- a call that fails with a provider quota after reaching the provider is charged the remaining candidate budget;
- a resumed cross-check that the daily budget cannot afford waits without a call or a deferral;
- a turn without provider capacity keeps the call pending and out of the owner queue, and the next turn settles it;
- `verified` events carry the outcome and the run identifier.

## Consequences

Lervo-managed statement corrections no longer wait for the owner when an independent reviewer agrees. A candidate the reviewer contests never reaches the owner queue. The owner still decides every user-owned byte. Each consequential candidate costs one more provider call within its existing budget, so the 40,000-token target per applied update is unchanged. A same-provider reviewer is weaker than a different provider. Follow-up: when a second provider passes no-capability admission, select it for Tier 0 and verify with a two-provider fixture that the generation and cross-check usage records name different providers.
