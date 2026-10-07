# Document freshness candidates

## Candidate contract

The provider returns `{ operation, hunks[], archiveName, currentDocumentPath, explanation }`. Each hunk specifies `before` text occurring exactly once in the document, replacement `after`, and claims citing bundle evidence. Lervo derives byte ranges from that unique match; providers cannot select unrelated bytes. Responses outside this contract reject the candidate as `candidate_invalid`.

`DocumentFreshnessCandidateV1` contains:

- `candidateId` (`kfresh_` plus 24 hex, derived from decision content excluding time), `generationId`, `findingDigest`, `bundleHash`, `documentPath`, `sourceHash`, `priorityClass`, `operation`.
- For `operation: edit`, `hunks[]`: `{ hunkId, range: { startByte, endByte }, beforeHash, replacement, changeClass, ownership, managedBlockId or null, authorityRequired, crossCheckRequired, claims[] }`. Each claim is `{ claimDigest, text, evidence[]: { path, hash, lineRange or null } }`.
- For `operation: archive`, `archive`: `targetPath` under `documentFreshness.historicalRoot`, `banner`, `inboundLinkRewrites[]` and `outgoingLinkRewrites[]` of `{ path, line, from, to }`, `ownership`, and the content hash of every rewritten inbound document.
- For `operation: no_change_needed` or `needs_owner_input`, `explanation` of at most 1 KiB.
- `authorityRequired: none | principal_mandate | owner`, `state`, `checks[]`, `crossCheck`, `beforeBytesRef` (CAS), `afterHash` of the full verified output, `appliedHash` after the latest apply, `appliedHunkIds[]`, `pendingHunkIds[]`, `tokensObserved`, `rejection`, `approval`, `commitHash`, and `acknowledgedAt`.

States are `generated`, `verified`, `verified_pending_cross_check`, `waiting_authority`, `applied`, `partially_applied`, `rejected`, `superseded`, and `reverted`.

- `verified` is transient for edits Lervo applies itself and final for `no_change_needed`.
- `verified_pending_cross_check` means all deterministic checks passed but a hunk needs Tier 0; until Tier 0 exists, the owner reviews it instead.
- `partially_applied` means Lervo-managed hunks applied and the remainder wait. The candidate records both sets.

## Change class rules

- `safety_or_policy`: a source line spanned by the hunk matches a safety pattern; or the document is `AGENTS.md` or `CLAUDE.md` at any depth and a spanned line is an instruction starting with a verb from a closed imperative list, optionally after a list marker; or the document is a decision record and the hunk lies under `## Decision`. This class takes precedence.
- `factual_reference`: every token added by the replacement (paths, symbols, versions, commands, and numbers with units) appears byte-exact in the evidence text cited by the hunk's claims.
- `statement`: everything else.

## Deterministic checks

Each check records `{ code, status: passed or failed, detail }` on the candidate. The `verified` event carries `{ code, status }`.

| Code                          | Rule                                                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source_hash`                 | Current document hash equals `sourceHash`.                                                                                                                                                                |
| `outside_bytes_unchanged`     | Every byte outside hunk ranges is identical after apply, checked independently of output production.                                                                                                      |
| `commonmark_structure`        | Output parses. Heading count, depth, and text are unchanged unless a `factual_reference` hunk spans the heading line. `lervo_v1` marker bytes and block identifiers are unchanged.                        |
| `references_resolve`          | Every relative link and path span in the output resolves in the current tree under ADR-0464, or is on a line marking history (`historical`, `archived`, `superseded`, `formerly`, `removed`, ...).        |
| `missing_references_resolved` | Every unresolved reference in the finding is replaced, removed, or marked historical.                                                                                                                     |
| `claims_bound`                | Every hunk has a claim; every claim cites at least one `{ path, hash }` from bundle evidence.                                                                                                             |
| `edit_bound`                  | Changed bytes, measured per hunk after the common prefix and suffix, are at most 25 percent of the document and 4 KiB.                                                                                    |
| `entrypoint_bounds`           | An entrypoint may not grow past these byte/line limits: `README.md` 12,288/160; `AGENTS.md` 8,192/120; `CLAUDE.md` 2,048/40. ADR-0206 protected README coordinates are unchanged except repository paths. |
| `writing_contract`            | Replacement adds no deterministic `writing_en-human` violation absent from the replaced text.                                                                                                             |

An archive records `source_hash`, `outside_bytes_unchanged` (target path is free), and `edit_bound` (banner fits `maximumEditBytes`).

## Cross-check

Cross-check is required when any hunk is `statement` or `safety_or_policy`, its bytes are user-owned, or `operation` is `archive`. `crossCheck: always` requires it everywhere; `never` is refused for user-owned bytes.

The design enqueues an ADR-0460 Tier 0 `cross_check` with `DecisionPointSignal.kind: document_freshness` and the fixed question: "For each hunk, does the replacement follow from the cited evidence, and does the candidate change nothing else?"

`agreement` would mark the candidate `verified`. `material_disagreement` rejects it with `cross_check_disagreement` and contested `hunkId`s, then regenerates once. A second disagreement raises `document_freshness_blocked`.

Version 1 has no Tier 0 because ADR-0460 Slice 1 is unimplemented. The candidate records `crossCheck: unavailable`; each hunk needing cross-check carries `crossCheckRequired: true`; the candidate waits in `verified_pending_cross_check`. Owner approval substitutes for the missing cross-check. Nothing in that state applies without it.
