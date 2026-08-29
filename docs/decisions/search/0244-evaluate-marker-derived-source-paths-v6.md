# ADR-0244: Evaluate marker-derived source paths v6

Status: `accepted`

## Context

Reference-marker v5 achieved exact marker/path bijection for every structurally valid result, but five malformed JSON results reduced formatting and retrieval scores. A ground-truth audit found that the fuzzy-merge case omitted the current approval-gated fuzzy-merge decision and incorrectly expected the older exact-merge decision.

On 2026-08-28, the user approved one correction: retain hash-bound human resolution ADR-0180, replace exact-merge ADR-0187 with approval-gated fuzzy-merge ADR-0227, and include ADR-0227 in the corpus. The other seven cases remain unchanged. The v6 fixture is human-reviewed but neither promotes earlier suites nor establishes production quality.

## Decision

Pre-register `marker-derived-paths-v6` with the corrected eight-case ground truth. Preserve v5's lexical-v1 recommendations, deterministic core-and-term coverage, no-hit-only catalog exploration, three repetitions, rotating arm order, thresholds, and contemporaneous model-direct comparison.

Derive candidate source paths only from recognized output markers. Existing exact `lervo-e4` markers identify supplied evidence bodies. For no-hit catalog exploration, bind every catalog entry to deterministic opaque inspection and source tokens. Require one to four inspection tokens, repository inspection, and a source token for every inspected catalog source used in the answer. Reject unknown, malformed, duplicated, out-of-scope markers and markers associated with uninspected sources.

The provider returns bounded Korean prose, not JSON. Score retrieval from recognized markers even when response formatting fails. Report response-contract failures separately from provider execution failures. A marker proves only an observable bounded-output reference; it never proves attention, semantic reliance, understanding, agreement, correctness, completeness, or internal use.

Retain all v5 quality and resource thresholds. Add zero thresholds for source-marker and response-contract failures. Any failed criterion rejects v6. This decision authorizes evaluation only. `lexical-v1` remains operational unless a later reviewed decision explicitly changes production routing.

## Privacy and failure meaning

Queries and approved ground-truth coordinates are checked-in public fixtures. Raw answers and markers remain mode-`0600` operator output outside the repository. Tracked reports exclude answer prose, markers, source bodies, and absolute paths.

`source_marker_contract_failed` means marker coordinates are malformed, unknown, duplicated, forbidden, or claim an uninspected catalog source. `response_contract_failed` means the bounded prose and marker envelope is invalid. `coverage_contract_failed` means a lexical no-hit did not produce bounded candidate markers and observable repository inspection. Existing provider and relevant-source preservation failures retain their previous meanings. None of these failures changes production routing.

## Consequences

The accepted repeated experiment rejected v6. It passed 13/24 grounded-answer verdicts versus 19/24 for model direct, passed every repetition for three cases versus six, and reached 64.58% recall versus 87.50%. It used 46.42% of direct tokens and 48.26% of direct duration, but failed repeatability, pass-count and recall non-inferiority, no-hit latency stability, three no-hit coverage and response contracts, one relevant recommendation, and two relevant deterministic coverage-source preservation checks.

All 24 v6 turns completed with usage observations and no provider execution failure. The 51 recognized evidence references had no source-marker-contract failure. Separating response formatting from retrieval scoring removed v5's JSON-collapse ambiguity but did not repair source selection. The human-reviewed fuzzy case passed all repetitions in both arms; the rejected aggregate result does not reverse the approved ground-truth correction.

`lexical-v1` remains operational. V6 is a negative evaluation baseline and is not authorized for production activation or provenance promotion. See the [redacted v6 observation](../../evidence/search/marker-derived-paths-v6.md).

## Verification

- Prove that only the approved fuzzy case and necessary self-exclusions differ from v5's ground truth.
- Test exact injected and catalog marker derivation, malformed and unknown markers, and the human-reviewed fuzzy coordinates.
- Verify that dry-run recommendations retain lexical expectations and deterministic coverage with ADR-0227 present.
- Bind the repeated report to the suite, protocol, corpus, repository snapshot, provider, model, marker policy, ground-truth review, privacy, repetitions, and exact acceptance criteria.
- Complete repository quality, tests, builds, documentation lifecycle, knowledge refresh, and release-completion checks.
