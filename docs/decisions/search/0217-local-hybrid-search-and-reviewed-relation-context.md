# ADR-0217: Local hybrid search and reviewed relation context

Status: `accepted`
Decision date: 2026-08-25

## Context

Keyword search is deterministic and observable but can miss reviewed documents that use related wording. Repository relations can identify useful neighbors, but graph data must not alter search-engine scores or identities. Lervo v0 must work without a Hub. Selected, loaded, injected, referenced, and used remain distinct claims.

Codex and Claude deliberation `dlb_bfafdd74ec1d402dbdc4ae790c50a474` ended without consensus after two rounds. Both accepted local-first search. Claude required relation targets to hash current bytes against a named source snapshot, reuse only registered document identifiers, and validate top-10 results through a separate reviewed evaluation bundle without weakening the top-50 comparison contract. This decision incorporates those corrections.

Deliberation `dlb_858e018de9994f479d436f730161ac0b` also ended without consensus. It established that deterministic case results and observational timings remain separate, every task type needs its own minimum sample, and an aggregate benchmark cannot authorize activation. Claude rejected a combined 20-case total as an adoption gate; this limitation remains.

Performance deliberation `dlb_a6920272bdb344319ed2ced28bf5a020` ended without consensus after identifying vector feature construction as the dominant build cost. Its review required an additive prepared-corpus path that leaves baseline construction unchanged, exact-output differential tests for representation changes, a fresh observation after the adapter build identity changes, and explicit separation between passing the cost bound and authorizing adoption. This decision incorporates those requirements.

## Decision

### Register a local hybrid candidate

Register `local-hybrid-v1` behind `SearchEnginePort` as an inactive candidate. It combines the current `lexical-v1` ranking with a local sparse embedding projection that:

- normalizes text with Unicode NFKC;
- hashes unique words, adjacent word pairs, and per-word character trigrams into 4,096 integer dimensions using a deterministic code-point FNV-1a projection;
- applies fixed field weights; and
- uses an inverted feature index to bound warm-query work to matching postings.

Lexical-weighted rank-sum fusion uses both top-50 branches. It returns the existing schema-v1 response with positive safe-integer scores, canonical source-key ties, and the union of matched fields.

The hybrid adapter uses an immutable core-prepared corpus through an additive lexical entry point. The ordinary `LexicalSearchIndex` constructor still performs baseline validation, cloning, sorting, hashing, normalization, and tokenization. The hybrid-only entry point reuses the prepared corpus and observes the lexical token projection during construction, avoiding a second corpus preparation and field-tokenization pass.

The sparse projection preserves the same features and hashed dimensions while caching normalized token, trigram, and adjacent-pair identities. It continues FNV-1a from cached prefix and left-token states instead of assembling temporary prefixed feature strings. Source contributions are accumulated in fixed 4,096-dimension arrays with four-bit field masks, then stored as dimension offsets, 16-bit source indexes, 64-bit contributions, and 8-bit masks. The 4,096-source corpus bound makes the source width safe. These representation changes alter adapter build identity but not engine version, embedding identity, fusion identity, index identity, scores, matched fields, or ordering.

Index identity binds the corpus digest, engine version, embedding dimensions and algorithm, and fusion version. Adapter build identity binds the package implementation revision. The projection uses no network, random value, clock, model download, or floating-point ordering. It is deletable and rebuildable.

Activation must follow the accepted registry, comparison, replay, review, policy, fail-closed resolution, and rollout chain. A reviewed lexical quality report with `failures_observed` must first demonstrate need. Compare baseline and candidate through the existing top-50 engine response contract. Use a separate reviewed bundle whose cases set `maximumRank=10` for the paired top-10 product criterion; never derive an unrecorded top-10 gate from another comparison. No candidate may regress a reviewed baseline case.

### Measure quality and latency separately

`lervo search benchmark --suite <path>` loads a checked-in public verification suite and writes an owner-only observational report under `.lervo/state/search/performance-reports/`. The repository suite contains exactly four explicit task types, each with five `maximumRank=10` cases:

- exact repository terminology;
- wording or morphology variation;
- multiple expected sources; and
- ambiguous near-neighbors.

Reports bind the benchmark-runner build identity and exclude query text, paths, and document bodies. The public suite remains the reviewable source of those inputs.

Deterministic quality metrics are Success@10, mean Recall@10, MRR, per-case ranks, task-type coverage wins, and task-type ranking wins. Timings use a monotonic clock and exclude corpus loading. Five paired build warmups precede 30 recorded pairs with alternating engine order. Both query indexes are then built once; five warm passes precede 30 repetitions per query with alternating engine order and rotated case order. Reports retain build and warm-query p50 and p95, bounded runtime, and machine characteristics. Power state and competing workloads remain explicitly unobserved.

The aggregate observation threshold requires two additional successful cases, a 10-percentage-point Success@10 increase, a 5-point Recall@10 increase, nonnegative MRR, and no baseline coverage win. Candidate cost is acceptable only when warm-query p95 is at most 1.5 times baseline and build p95 is at most three times baseline. Ratios at or below 0.9 are faster, ratios from 0.9 through 1.1 are comparable, and ratios at or above 1.1 are slower. These labels are observations, not rollout decisions. Activation remains governed by all four dedicated task-type gates, the existing reviewed comparison and replay chain, and human rollout review.

### Traverse reviewed relations after search

Repository knowledge query creates a separate one-hop relation projection after direct lexical knowledge hits. At most five direct concepts seed it. It examines at most 64 incident relations, recommends at most five distinct documents, and selects at most two. Only current, human-reviewed endpoints and relations qualify. A target concept path must identify exactly one concept and one current registered document. Lervo never creates a general Markdown document identifier for a relation target.

The projection binds its source snapshot, impact report, exact concept-sidecar and relation-sidecar set hashes, seed concepts, budgets, ordered relation coordinates, registered document ID, and SHA-256 hash of current target bytes. Relation data never enters a search index identity, search score, result-set hash, or `SearchAttempt`. A later byte mismatch fails before provider start.

Managed context records a graph-selected document with the new `graph_recommendation` E1 reason, followed by the ordinary exact-byte E2 load and adapter-acknowledged E3 injection. Every root agent and subagent creates these receipts in its own run and session. Neither projection nor recommendation proves selection, injection, reference, relevance, or use.

## Bounds, privacy, and failures

No event type or evidence state is added. `context.selected` retains its required project, run, session, document, policy, scope, time, reason, and rule fields. For `graph_recommendation`, the rule contains only the opaque recommendation identifier. Events exclude relation text, document bytes, query text, paths, and sidecar contents.

`invalid_graph_recommendation` means coordinates, ordering, registry identity, snapshot metadata, content hash, or the five/two budgets are invalid. Context preparation then fails before partial injection or provider start. Search candidates retain existing `invalid_evaluation_engine`, `invalid_query`, and comparison or activation failures. An absent or ineligible relation yields no graph recommendation and does not alter direct search.

## Verification

The shared engine contract rebuilds from forward and reversed corpus order and compares repeated top-50 results. Focused tests cover:

- a morphology-adjacent candidate win over `lexical-v1` in the same reviewed `maximumRank=10` case;
- exact index replay;
- complete response equivalence with the previous representation for Unicode, deliberate hash collisions, duplicate labels, repeated and concurrent searches, reversed input, and the 4,096-source boundary;
- immutable core-prepared corpus reuse without changing ordinary lexical construction;
- report privacy;
- benchmark-protocol sample counts;
- owner-only report storage;
- sidecar-bound projection identity;
- ambiguous concept-path exclusion;
- registered-document resolution;
- graph budgets; and
- E1/E2 selection and byte validation.

Existing provider adapter contracts continue proving that every loaded selected document receives its run-local E3 receipt. The checked-in [repository retrieval observation](../../evidence/search/repository-retrieval-v1.md) records the fixed-suite result without changing activation state.

## Consequences

Lervo can measure a local semantic-recall candidate without a remote dependency or stored-attempt schema changes. Reviewed graph relations improve document exploration through an auditable recommendation layer. Activation remains gated on real lexical failures and reviewed no-regression evidence. Verification-authored repository results do not establish production quality, latency under load, energy use, or an adoption decision.

The optimized adapter can satisfy the repository build and warm-query cost bounds while preserving the recorded quality result. Cost acceptance does not resolve the failed aggregate coverage threshold, per-task coverage gates, or case regressions, so the candidate remains inactive and adoption remains undetermined.
