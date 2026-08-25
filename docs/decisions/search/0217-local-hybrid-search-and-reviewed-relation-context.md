# ADR-0217: Local hybrid search and reviewed relation context

Status: `accepted`
Decision date: 2026-08-25

## Context

Keyword search is deterministic and observable, but related wording can miss a reviewed document. Repository relations can reveal a useful neighboring document, but graph data must not change search-engine scores or identities. Lervo v0 must continue working without a Hub, and selected, loaded, injected, referenced, and used remain different claims.

Codex and Claude deliberation `dlb_bfafdd74ec1d402dbdc4ae790c50a474` completed without consensus after two rounds. Both accepted the local-first direction. Claude's final blockers required relation targets to hash current bytes against a named source snapshot, reuse only registered document identifiers, and express top-10 validation through a separate reviewed evaluation bundle rather than weakening the existing top-50 comparison contract. This decision incorporates those corrections.

## Decision

### Register a local hybrid candidate

Register `local-hybrid-v1` behind `SearchEnginePort`. It combines the current `lexical-v1` ranking with a local sparse embedding projection. The projection normalizes text with Unicode NFKC, hashes words, adjacent word pairs, and character trigrams into 4,096 integer dimensions, and uses fixed field weights. Rank-sum fusion operates on the two top-50 branches and returns the existing schema-v1 response with positive safe-integer scores, canonical source-key ties, and the union of matched fields.

The index identity binds the corpus digest, engine version, embedding dimensions and algorithm, and fusion version. The adapter build identity binds the package implementation revision. The projection uses no network, random value, clock, model download, or floating-point ordering and is deletable and rebuildable. It is a candidate, not the active engine.

Activation still uses the accepted registry, comparison, replay, review, policy, fail-closed resolution, and rollout chain. A reviewed lexical quality report with `failures_observed` must establish measured need first. Compare baseline and candidate with the existing top-50 engine response contract. Create a separate reviewed bundle whose cases set `maximumRank=10` for the paired top-10 product criterion; do not derive an unrecorded top-10 gate from another comparison. No candidate may regress a reviewed baseline case.

### Traverse reviewed relations after search

Repository knowledge query creates a separate one-hop relation projection after direct lexical knowledge hits. At most five direct concepts seed the projection; it examines at most 64 incident relations, recommends at most five distinct documents, and selects at most two. Only current, human-reviewed endpoints and relations qualify. The target concept path must identify exactly one concept and exactly one current registered document. Lervo never mints a general Markdown document identifier for a relation target.

The projection binds its source snapshot, impact report, exact concept-sidecar and relation-sidecar set hashes, seed concepts, budgets, ordered relation coordinates, registered document ID, and the SHA-256 hash calculated from current target bytes. Relation data never enters a search index identity, search score, result-set hash, or `SearchAttempt`. A later byte mismatch fails before provider start.

Managed context records a graph-selected document through the new `graph_recommendation` E1 reason, then uses the ordinary exact-byte E2 load and adapter-acknowledged E3 injection. Every root agent and subagent creates those receipts in its own run and session. The projection and a recommendation do not prove selection, injection, reference, relevance, or use.

## Bounds, privacy, and failures

No new event type or evidence state is added. `context.selected` retains its existing required project, run, session, document, policy, scope, time, reason, and rule fields. For `graph_recommendation`, the rule contains only the opaque recommendation identifier; relation text, document bytes, query text, paths, and sidecar contents do not enter events.

`invalid_graph_recommendation` means coordinates, ordering, registry identity, snapshot metadata, content hash, or the five/two budgets are invalid. Context preparation fails before partial injection or provider start. Search candidates retain existing `invalid_evaluation_engine`, `invalid_query`, and comparison/activation failures. An absent or ineligible relation yields no graph recommendation and leaves direct search unchanged.

## Verification

The shared engine contract rebuilds from forward and reversed corpus order and compares repeated top-50 results. Focused tests cover a morphology-adjacent candidate win over `lexical-v1` in the same reviewed `maximumRank=10` case, exact index replay, sidecar-bound projection identity, ambiguous concept-path exclusion, registered-document resolution, graph budgets, and E1/E2 selection and byte validation. Existing provider adapter contracts continue to prove that every loaded selected document receives its run-local E3 receipt.

## Consequences

Lervo can measure a local semantic-recall candidate without introducing a remote dependency or changing stored attempt schemas. Reviewed graph relations improve document exploration through an auditable recommendation layer. Activation remains deliberately gated on real lexical failures and reviewed no-regression evidence; this ADR does not claim the candidate is better on a production corpus.
