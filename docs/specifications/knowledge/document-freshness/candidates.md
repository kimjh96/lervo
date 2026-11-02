# Document freshness candidates

## Candidate contract

The provider returns `{ operation, hunks[], archiveName, currentDocumentPath, explanation }`. Each hunk specifies `before` text occurring exactly once in the document, replacement `after`, and claims citing bundle evidence. Lervo derives byte ranges from that unique match; providers cannot select unrelated bytes. Responses outside this contract reject the candidate as `candidate_invalid`.

`DocumentFreshnessCandidateV1` contains:

- `candidateId` (`kfresh_` plus 24 hex, derived from decision content excluding time), `generationId`, `findingDigest`, `bundleHash`, `documentPath`, `sourceHash`, `priorityClass`, `operation`.
- For `operation: edit`, `hunks[]`: `{ hunkId, range: { startByte, endByte }, beforeHash, replacement, changeClass, ownership, managedBlockId or null, authorityRequired, crossCheckRequired, claims[] }`. Each claim is `{ claimDigest, text, evidence[]: { path, hash, lineRange or null } }`.
- For `operation: archive`, `archive`: `targetPath` under `documentFreshness.historicalRoot`, `banner`, `inboundLinkRewrites[]` and `outgoingLinkRewrites[]` of `{ path, line, from, to }`, `ownership`, and the content hash of every rewritten inbound document.
- For `operation: no_change_needed` or `needs_owner_input`, `explanation` of at most 1 KiB.
- `authorityRequired: none | principal_mandate | owner`, `state`, `checks[]`, `crossCheck`, the additive `crossCheckReview` (see [Cross-check](#cross-check)), `beforeBytesRef` (CAS), `afterHash` of the full verified output, `appliedHash` after the latest apply, `appliedHunkIds[]`, `pendingHunkIds[]`, `tokensObserved`, `rejection`, `approval`, `commitHash`, and `acknowledgedAt`.

States are `generated`, `verified`, `verified_pending_cross_check`, `waiting_authority`, `applied`, `partially_applied`, `rejected`, `superseded`, and `reverted`.

- `generated` also holds an edit whose Tier 0 call has not settled; it is not in the owner queue.
- `verified` is transient for edits Lervo applies itself and final for `no_change_needed`.
- `verified_pending_cross_check` means all deterministic checks passed but a hunk that needs Tier 0 has no agreement because the cross-check was unavailable; the owner reviews it instead.
- `partially_applied` means Lervo-managed hunks applied and the remainder wait. The candidate records both sets.

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

[ADR-0557](../../../decisions/knowledge/documents/freshness/0557-cross-check-freshness-candidates-in-an-independent-no-capability-session.md) runs Tier 0 as one call in a fresh no-capability session of an admitted provider, separate from generation. The fixed question is: "For each hunk, does the replacement follow from the cited evidence, and does the candidate change nothing else?"

- **Input**, stored in CAS by hash: per hunk, the exact source bytes, the replacement, up to three context lines on each side, the change class, and the claims with evidence coordinates. It also carries the cited bundle evidence excerpts, at most 6 KiB each and 24 KiB in total.
- **Output**: `{ hunks: [{ hunkId, verdict: agree | disagree, reason }] }`, exactly one verdict per hunk, with a reason of 1 to 400 characters. Any other shape is invalid and settles as `unavailable`.
- **Budget**: the call counts inside `maximumTokensPerCandidate` and the daily budget. An estimated or observed overrun settles as `unavailable` with `freshness_budget_exhausted`.

| Outcome | Effect |
| --- | --- |
| `agreement` | The owner substitution is removed. Lervo-managed hunks with authority `none` apply in the settling cycle (`verified`); user-owned and `safety_or_policy` hunks keep their authority (`waiting_authority`). |
| `material_disagreement` | `rejected` with `cross_check_disagreement`, `rejectorKind: cross_check`, and the contested `hunkId`s. The finding regenerates once; a second disagreement raises `document_freshness_blocked` with `repeated_cross_check_disagreement`. |
| `unavailable` | `verified_pending_cross_check`; owner approval substitutes. Lervo-managed hunks that do not need the cross-check still apply. |

`crossCheckReview` records `status` (`pending` or `settled`), `inputHash`, `runId` (the call's ADR-0459 run, also the `verified` event's `deliberationRunId`), `reviewerProvider`, `outcome`, `unavailableReason`, per-hunk `verdicts`, `tokensObserved`, `deferrals`, and `settledAt`. `unavailableReason` is one of `freshness_budget_exhausted`, `knowledge_authority_unavailable`, `knowledge_capacity_unavailable`, `knowledge_provider_paused`, `provider_not_admitted`, `cross_check_input_unavailable`, `cross_check_provider_failed`, `cross_check_usage_unavailable`, `cross_check_response_invalid`, or `archive_not_cross_checked`.

While the call is pending, the candidate stays `generated` and nothing applies. A turn without provider capacity leaves it pending; the next cycle resumes it before new generation, and eight such turns settle it as `unavailable`. Archives are not cross-checked in this version and record `archive_not_cross_checked`. The ADR-0460 `document_freshness` decision-point signal still awaits ADR-0460 Slice 1.
