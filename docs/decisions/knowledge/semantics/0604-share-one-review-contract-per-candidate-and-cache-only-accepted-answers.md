# ADR-0604: Share one review contract per candidate and cache only accepted answers

Status: `accepted`
Decision date: 2026-11-21
Amends: [ADR-0479](0479-park-rejected-semantic-candidates-and-settle-opaque-assets-by-the-delegation-suite.md) (the normalization review the stage parses), [ADR-0486](0486-regenerate-stale-semantic-candidates-and-reuse-repository-observation.md) (stale candidates)
Related: [ADR-0600](../maintenance/0600-rewind-an-obligation-whose-own-commits-were-undone.md) (rewinds)

## Context

On 2026-11-21 flemo's owner stopped at `normalization_review` with `knowledge_semantic_review_invalid`, with 13 normalization debts behind it.

The review contract asked the provider to copy 64-character hashes and identifiers back into its answer. The validator demanded an exact match. The provider garbled a hash in both attempts: one character dropped and two swapped (`…dabf9bd5…` came back as `…dab9fbd5…`). Across the 29 stored normalization reviews, 7 of 278 output hashes and one unit id had been garbled the same way.

The schema could not stop this. It said only `string`: it was a fixed type check, while the validator was a per-candidate identity check.

Two further causes made the failure permanent:

- The provider cache stored the invalid answers, so a replay with the same input failed forever.
- The test provider built its answers from hidden candidate data, so a garbled hash never reached the validator in tests.

The same day the WSL owner also hit "the workset does not match the current normalization lifecycle" at `normalization_apply`, at 05:36 UTC on v0.29.10. A rewind (ADR-0600) had restarted an obligation, and its completed generation assignment replayed an older candidate. The lifecycle had moved since that candidate was generated. Lervo called the candidate invalid, a non-retryable `knowledge_compile_failed`, so the stage settled as attention.

## Decision

### One contract per candidate, shared by the request and the parser

`normalizationReviewContract(candidate)` builds three things from one candidate:

- **`view`:** the candidate as the reviewer sees it. A short reference replaces every identifier the reviewer must cite: `d1` for a document, `d1.u2` for a source unit, `d1.o3` for an output. Each output lists the unit references it covers. No hash or opaque identifier reaches the reviewer.
- **`schema`:** the response schema. Each reference field is an `enum` of exactly this candidate's references. The provider schema adapter keeps `enum` for Codex, so a garbled reference cannot be produced.
- **`parse`:** maps the references back to the exact operation ids, source hashes, unit version ids and output hashes. It also keeps every rule a schema cannot state: one answer per document, every unit of an approved document reviewed exactly once, outputs from the same document that cover the unit, and every check true.

Decisions downstream still bind exact identifiers. The contract has a version, `lervo.normalization-review.v3`, which the review cost key includes. Version 3 scopes each document's answer to its own units and outputs and pairs each output with its path.

### One reference helper for every review stage

`review-references.ts` in `@lervo/repository-knowledge` holds the pattern, so a new stage has no way to ask for a copied hash:

- `reviewReferences(items, { prefix, path })` assigns the references, gives the `enum` of the references and of the item paths, and maps an answer back. Where an item has a path or another natural key, the answer names it next to the reference, and both must name the same item. A valid reference to the wrong item is rejected too.
- An empty `enum` is never emitted. A reference that may be null allows only `null` when nothing can be cited. An array that cites references gets `maxItems: 0`, which its parser enforces, because the Codex schema adapter drops `maxItems`.

Every stage now uses it:

| Stage                                                | The provider cites                                                                                | Lervo binds                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Normalization review                                 | `d<n>` with its source path; only its own `d<n>.u<m>`, and its own `d<n>.o<m>` each with its path | operation ids, unit ids, output hashes                                       |
| Canonical assessment                                 | `s<n>` and `c<n>`, each with its path                                                             | source and context hashes; a draft's `beforeHash` from the captured snapshot |
| Canonical review                                     | nothing: a decision and a rationale                                                               | the assessment, source and draft hashes                                      |
| Candidate resolution                                 | `k<n>` with its first source path, and a target `c<n>` with its path                              | candidate id and hash, target hash                                           |
| Route classification, background and foreground      | `d<n>` with its path, and the configured route and role ids                                       | path and content hash                                                        |
| Lifecycle plan review                                | nothing: a decision and a rationale                                                               | the exact plan hash                                                          |
| Freshness generation and no-change assessment review | `e<n>` with its path, or nothing                                                                  | evidence `{ path, hash }`, document hash and dependency digest               |
| Freshness Tier 0 cross-check                         | `h<n>` with its anchor, the start of its before and after text (`old -> new`)                     | `hunkId`s                                                                    |
| Practice draft                                       | a target `t<n>` with its skill path, or nothing                                                   | the target's content hash and the catalog digest                             |
| Practice review and unused-skill re-evaluation       | nothing: a decision and a reason code, or keep or retire                                          | draft, evidence, target and catalog hashes; the skill version                |
| Capability install cross-check                       | nothing: a decision and a rationale                                                               | the exact package bytes it sent                                              |

A canonical draft names only its path and bytes. It may replace an existing target only when the call showed that target's exact bytes; otherwise the bounded retry supplies them. `reviewKnowledgeJson` takes an optional `binding`, such as the lifecycle plan hash or the route request digest, which joins the cache key but never reaches the provider.

### Every parser rejects a broken answer, apart from its verdict

A well-formed rejection, deferral or `uncertain` is a verdict and is cached. An answer that breaks the contract throws `knowledge_semantic_review_invalid`, so `accept` never caches it as a verdict:

- The lifecycle plan review used to read any malformed answer as a rejection, and route classification used to record one as `uncertain`. Both were cached and replayed.
- A malformed lifecycle answer now settles as invalid with its observation as evidence. In the foreground cross-check it reports `knowledge_cross_check_unavailable`, never a disagreement.
- A malformed no-change freshness review, or a failed review call, is no verdict either. It is asked once more at once, within the candidate's token budget; if there is still none, the candidate keeps its state, charged, and the next cycle asks again. Only a well-formed `agrees: false` is a disagreement.
- A well-formed agreement whose usage the provider did not report cannot be checked against the budget, so it is unverifiable: the candidate stays, charged, and is asked again. A call whose usage is unknown is charged its request's size, as the cross-check estimates it, never the whole budget. Every answer without usage counts, whatever its verdict; after three in a row, that provider's reviews are not paid for for a day. The resident wakes when the pause ends, the stage reopens then, and the `document_freshness_blocked` attention with `usage_unavailable` lasts only while the pause does. The end of a pause is due once: the stage clears it and keeps the count, so a later cycle with nothing else to do is unchanged again, and one more answer without usage pauses the provider again. A full cycle carries the count and any pause forward. An answer with usage clears the count. An agreement that came in over the candidate budget is `freshness_budget_exhausted` with the `budget` rejector. Neither is ever a disagreement.
- A malformed route answer records no verdict. Lervo counts the violation per document, bound to the exact bytes and route set, in host-private `document-route-classification-violations.json`. The documents stay pending with the resolution `classification_invalid`, which operating attention reports first as `document_route_classification_invalid`, and a later valid answer ends it. The request's one-call budget keeps the same obligation from paying again.
- A malformed practice draft, review or re-evaluation throws `knowledge_semantic_review_invalid`; the candidate keeps its state and the funnel records `review_invalid`. Practice calls are not cached, so they need no `accept` or `binding`: Lervo attaches the exact binding when it parses the verdict.
- A malformed capability install answer reports `capability_cross_check_unavailable`. Nothing is installed or held as a disagreement.

### Only an accepted answer is cached

`reviewKnowledgeJson` takes the caller's own parser as `accept`. The parameter is required, so every review stage must pass one:

- An answer `accept` rejects is returned to the caller, which still reports it, but it is never cached.
- A cached answer `accept` rejects, such as one an earlier release stored, is asked for again.

So an invalid answer is never replayed. This covers every review stage: canonical assessment, canonical review, candidate resolution, route classification, lifecycle plan review and normalization review. Freshness calls do not use this cache.

### A moved lifecycle makes a candidate stale, not invalid

When the normalization lifecycle no longer matches the candidate at the same source snapshot, planning throws `knowledge_plan_stale`, not `knowledge_compile_failed`. That covers both the complete source set and the workset counts. The apply stage then sends the same batch back to `normalization_generation` and names the stale candidate in its stage data. A changed stage data changes the generation's assignment identity, so the generation runs against the current lifecycle instead of replaying the old candidate. It can repeat only when the lifecycle really moves again.

A stale regeneration could still loop for free, because the replayed generation and the cached review cost nothing. So:

- The same stale path serves `knowledge_plan_stale` at planning, the exact plan check before apply, and a selected source that is no longer pending (formerly `normalization_selection_invalid`).
- Each stale regeneration is its own batch with its own call budget, so a lifecycle move never spends the calls its review needs.
- The same candidate coming back stale, or a third stale regeneration in a row, settles attention as `normalization_candidate_stale_repeated`. The code is never retried. The chain resets when the batch settles any other way.

### Provider output schemas

[ADR-0608](0608-build-every-provider-output-schema-through-one-checked-helper.md) builds every provider output schema through one checked helper and makes the guard structural.

## Consequences

- flemo's stuck review is asked again with the new contract on its next cycle; the cached invalid answers are never used.
- The test provider now answers only from the view and schema it is given, the way a real provider does, so the real stage parses what a real reviewer could produce.
- A reviewer that ignores the schema and cites another document's output is still rejected by `parse`.

## Verification

- `normalization-review-contract.test.ts`: the view carries no hash, the schema enumerates exactly the references, references map back to the exact identifiers, and out-of-document, uncovered, garbled, missing and duplicate references are rejected.
- `provider-call-cache.test.ts`: an invalid answer is never cached, one an earlier release cached is asked for again, and an answer is replayed only for its own `binding`.
- `review-contract-cache.test.ts`: each stage's own parser, run through the provider call, caches a well-formed rejection and never a garbled answer.
- `canonical-assessment-contract.test.ts`, `candidate-review-contract.test.ts` and `document-route-classification-contract.test.ts`: the view carries no hash, the schema enumerates exactly the references, references map back to exact hashes, and a reference paired with another item's path is rejected. `document-route-classification.test.ts`: a mispaired answer records nothing.
- `document-normalization.test.ts`: a lifecycle moved at the same snapshot reads as `knowledge_plan_stale`.
- `normalization-review-contract.test.ts`, `candidate-review-contract.test.ts` and the `document-freshness-cross-check.test.ts` contract cases: a valid output, candidate or hunk reference paired with another item's path, source or anchor is rejected, and each document's schema names only its own units and outputs.
- `practice-review-contract.test.ts`, `practice-review.test.ts`, `practice-usage-review.test.ts` and `practice-stage.test.ts`: no practice schema or view asks for a hash, a mispaired or misplaced target and a malformed verdict throw, and the candidate keeps its state.
- `capability-install-cross-check.test.ts`: the reviewer echoes no package hash, and a malformed answer is unavailable, never a disagreement.
- `document-route-classification.test.ts`, `foreground-document-route-classification.test.ts` and `document-route-classification-attention.test.ts`: a broken answer is counted and raised as `document_route_classification_invalid` until a valid answer classifies the documents.
- `document-freshness-fixtures.test.ts`: an agreement with no usage is unverifiable and charged its size, an over-budget agreement is a budget rejection, never a disagreement, and a provider that reports no usage three times is not paid for again. A full cycle keeps a pause, its end reopens the stage once, and the next cycle is unchanged.
- `normalization-apply-stale.test.ts`: the apply stage regenerates the batch under its own budget and names the stale candidate. All three stale cases take that path, and a repeated or long stale chain settles `normalization_candidate_stale_repeated`. `document-normalization-stale-selection.test.ts`: a selected source that is no longer pending reads as stale.

Each test fails with its fix reverted.

- `freshness-usage-pause.test.ts`: a disagreement without usage still counts, the pause ends the resident's wait and reopens the stage, and its attention ends with it.
