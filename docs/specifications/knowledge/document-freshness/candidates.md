# Document freshness candidates

## Candidate contract

The provider returns `{ operation, hunks[], archiveName, currentDocumentPath, explanation }`. Each hunk specifies `before` text occurring exactly once in the document, replacement `after`, and claims citing bundle evidence. Lervo derives byte ranges from that unique match; providers cannot select unrelated bytes. Responses outside this contract reject the candidate as `candidate_invalid`.

`DocumentFreshnessCandidateV1` contains:

- `candidateId` (`kfresh_` plus 24 hex, derived from decision content excluding time), `generationId`, `findingDigest`, `bundleHash`, `documentPath`, `sourceHash`, `priorityClass`, `operation`.
- For `operation: edit`, `hunks[]`: `{ hunkId, range: { startByte, endByte }, beforeHash, replacement, changeClass, ownership, managedBlockId or null, authorityRequired, crossCheckRequired, claims[] }`. Each claim is `{ claimDigest, text, evidence[]: { path, hash, lineRange or null } }`. Since [ADR-0561](../../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), `authorityRequired` is always `none`; older records may carry `principal_mandate` or `owner`, which readers ignore.
- For `operation: archive`, `archive`: `targetPath` under `documentFreshness.historicalRoot`, `banner`, `inboundLinkRewrites[]` and `outgoingLinkRewrites[]` of `{ path, line, from, to }`, `ownership`, and the content hash of every rewritten inbound document.
- For `operation: no_change_needed` or `needs_owner_input`, `explanation` of at most 1 KiB. The wire name `needs_owner_input` is kept for event compatibility; it means the evidence did not determine the value, and the candidate is rejected as `candidate_invalid` so Lervo recovers evidence and regenerates (see [Undetermined values](#undetermined-values)).
- `authorityRequired: none`, `state`, `checks[]`, `crossCheck`, the additive `crossCheckReview` and `crossCheckRounds` (see [Cross-check](#cross-check)), `beforeBytesRef` (CAS), `afterHash` of the full verified output, `appliedHash` after the latest apply, `appliedHunkIds[]`, `pendingHunkIds[]`, `tokensObserved`, `rejection`, `approval`, `commitHash`, `acknowledgedAt`, and the additive `predecessorCandidateId` of the failed candidate a regeneration replaces.

States are `generated`, `verified`, `verified_pending_cross_check`, `waiting_authority`, `applied`, `partially_applied`, `rejected`, `superseded`, and `reverted`.

- `generated` also holds a candidate whose Tier 0 round has not settled, including the second of two required rounds.
- `verified` is transient for edits and archives Lervo applies itself and final for `no_change_needed`.
- `verified_pending_cross_check` means all deterministic checks passed but a hunk or archive that needs Tier 0 has no agreement yet because the call was unavailable. Lervo retries the call with backoff; nothing waits for the owner.
- `partially_applied` means hunks that needed no cross-check applied while the rest wait for the retried call. The candidate records both sets. A record written before ADR-0561 whose remainder waited for the owner is superseded for regeneration; its partial apply stays committed.
- `waiting_authority` exists only on records written before ADR-0561. Recovery supersedes such a record as `candidate_invalid`, so its finding regenerates under the current rules.

## Change class rules

- `safety_or_policy`: a source line spanned by the hunk matches a safety pattern; or the document is `AGENTS.md` or `CLAUDE.md` at any depth and a spanned line is an instruction starting with a verb from a closed imperative list, optionally after a list marker; or the document is a decision record and the hunk lies under `## Decision`. This class takes precedence.
- `factual_reference`: every token added by the replacement (paths, symbols, versions, commands, and numbers with units) appears byte-exact in the evidence text cited by the hunk's claims.
- `statement`: everything else.

## Deterministic checks

Each check records `{ code, status: passed or failed, detail }` on the candidate. The `verified` event carries `{ code, status }`.

| Code | Rule |
| --- | --- |
| `source_hash` | Current document hash equals `sourceHash`. |
| `outside_bytes_unchanged` | Every byte outside hunk ranges is identical after apply, checked independently of output production. |
| `commonmark_structure` | Output parses. Heading count, depth, and text are unchanged unless a `factual_reference` hunk spans the heading line. `lervo_v1` marker bytes and block identifiers are unchanged. |
| `references_resolve` | Every relative link and path span in the output resolves in the current tree under ADR-0464, is on a line marking history (`historical`, `archived`, `superseded`, `formerly`, `removed`, ...), or is a path mention the finding already recorded as `neverTracked` ([ADR-0558](../../../decisions/knowledge/documents/freshness/0558-treat-never-tracked-path-mentions-as-not-removed.md)). An edit cannot introduce a new absent path; past the 512-reference extraction cap, the whole output lines of every replacement are checked as well, and a replaced line that alone reaches the cap fails as `reference_limit_reached`. |
| `missing_references_resolved` | Every missing reference in the finding (unresolved and not `neverTracked`) is replaced, removed, or marked historical. |
| `claims_bound` | Every hunk has a claim; every claim cites at least one `{ path, hash }` from bundle evidence. |
| `edit_bound` | Changed bytes, measured per hunk after the common prefix and suffix, are at most 25 percent of the document and 4 KiB. |
| `entrypoint_bounds` | An entrypoint may not grow past these byte/line limits: `README.md` 12,288/160; `AGENTS.md` 8,192/120; `CLAUDE.md` 2,048/40. ADR-0206 protected README coordinates are unchanged except repository paths. |
| `writing_contract` | Replacement adds no deterministic `writing_en-human` violation absent from the replaced text. |

An archive records `source_hash`, `outside_bytes_unchanged` (target path is free), and `edit_bound` (banner fits `maximumEditBytes`).

## Cross-check

Cross-check is required when any hunk is `statement` or `safety_or_policy`, its bytes are user-owned, or `operation` is `archive`. `crossCheck: always` requires it everywhere; `never` is refused for user-owned bytes.

[ADR-0557](../../../decisions/knowledge/documents/freshness/0557-cross-check-freshness-candidates-in-an-independent-no-capability-session.md) runs Tier 0 as a call in a fresh no-capability session of an admitted provider, separate from generation. The fixed question is: "For each hunk, does the replacement follow from the cited evidence, and does the candidate change nothing else?"

- **Input**, stored in CAS by hash: per hunk, the exact source bytes, the replacement, up to three context lines on each side, the change class, and the claims with evidence coordinates. It also carries the cited bundle evidence excerpts, at most 6 KiB each and 24 KiB in total. An archive's input has one item for the move (the source path and up to 4 KiB of its text, against the target path and banner) and one item for all inbound link rewrites; it carries every bundle evidence excerpt under the same bounds.
- **Output**: `{ hunks: [{ hunkId, verdict: agree | disagree, reason }] }`, exactly one verdict per input item, with a reason of 1 to 400 characters. Any other shape is invalid and settles as `unavailable`.
- **Budget**: every round counts inside `maximumTokensPerCandidate` and the daily budget. An estimated or observed overrun rejects the candidate with `freshness_budget_exhausted`.

[ADR-0561](../../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md) sets how many independent agreeing rounds Lervo needs before it applies:

| Change | Agreeing rounds |
| --- | --- |
| Lervo-managed `statement` hunk; user-owned `factual_reference` hunk | 1 |
| `safety_or_policy` hunk in any ownership; user-owned `statement` hunk; archive with its inbound link rewrites | 2 |
| Lervo-managed `factual_reference` hunk | none under the default `required_for_consequential` policy |

The candidate needs the largest count any of its required hunks needs. Each round is a separate process and session with its own run identifier. When the resident resolves its provider by detection, the second round asks for the other provider first and falls back to its own when that provider is not admitted; a configured executable binds the provider, so the second round is a fresh session of the same provider. Both rounds usually run in the same turn; a turn without capacity leaves the next round pending.

| Outcome of a round | Effect |
| --- | --- |
| `agreement` short of the required count | The round moves to `crossCheckRounds`, a new pending round is armed on the same stored input, and the candidate stays `generated`. |
| `agreement` reaching the required count | `crossCheck: agreement`, `verified`; Lervo applies every pending hunk or the archive in the settling cycle. |
| `material_disagreement` in any round | `rejected` with `cross_check_disagreement`, `rejectorKind: cross_check`, and the contested `hunkId`s. The finding regenerates once with the contested replacements and the reviewer's reasons as evidence; a second failure holds the finding as [Lervo debt](operations.md#lervo-debt) with `cross_check_disagreement_repeated`. |
| `unavailable` with `freshness_budget_exhausted` | `rejected` with `rejectorKind: budget`; the finding becomes Lervo debt with `budget_exceeded`, unless a fresh candidate with its own budget regenerates first. |
| any other `unavailable` | `verified_pending_cross_check`; hunks that need no cross-check still apply. Lervo re-arms the call one hour after it settled, doubled for each earlier retry, at most one day, keeping the agreeing rounds and the stored input. |

`crossCheckReview` records `status` (`pending` or `settled`), `inputHash`, `runId` (the round's ADR-0459 run, also the `verified` event's `deliberationRunId`), `reviewerProvider`, `outcome`, `unavailableReason`, per-item `verdicts`, `tokensObserved`, `deferrals`, `settledAt`, and the additive `retries`. `unavailableReason` is one of `freshness_budget_exhausted`, `knowledge_authority_unavailable`, `knowledge_capacity_unavailable`, `knowledge_provider_paused`, `provider_not_admitted`, `cross_check_input_unavailable`, `cross_check_provider_failed`, `cross_check_usage_unavailable`, or `cross_check_response_invalid`. Records written before ADR-0561 may carry `archive_not_cross_checked`; recovery regenerates a held candidate whose stored input is missing.

While a round is pending, the candidate stays `generated` and nothing applies. A turn without provider capacity leaves it pending; the next cycle resumes it before new generation, and eight such turns settle it as `unavailable`. The ADR-0460 `document_freshness` decision-point signal still awaits ADR-0460 Slice 1.

## Undetermined values

A `needs_owner_input` answer never reaches the owner (ADR-0561). The candidate is rejected as `candidate_invalid` and keeps its explanation. The next cycle runs ADR-0494 evidence recovery, rebuilding the bundle from current revisions, and regenerates once with the explanation as `regeneration` evidence. When the regeneration also cannot determine the value, the document stays stale and the finding is held as [Lervo debt](operations.md#lervo-debt) with `freshness_evidence_undetermined`, shown in health with its age.
