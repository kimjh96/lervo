# ADR-0240: Evaluate catalog-assisted retrieval v3

Status: `accepted`

## Context

Lexical-assisted v2 reduced tokens and broad latency but failed quality and repeatability. Its provider-named evidence-gap trigger did not reliably detect incomplete top-three lexical bundles. Two no-hit phrasings also had worse p95 latency and standard deviation than direct repository exploration.

The next candidate must expose missing canonical alternatives without question-category routing, confidence-as-completeness, broader runtime activation, or relaxed acceptance thresholds.

## Decision

Pre-register `catalog-assisted-v3` as evaluation-only. Supply the top three `lexical-v1` documents as full evidence anchors and one deterministic catalog containing every sanitized corpus source's repository-relative path and first heading. The catalog contains no source bodies and is a candidate directory, not evidence.

Require `coverageAssessment` with exactly `status`, `candidatePaths`, and `reason`:

- `anchors_complete` permits no candidate paths or repository inspection.
- `catalog_candidates_named` requires one to four catalog paths outside the supplied anchors and observable read-only repository inspection.
- A lexical no-hit requires at least one named catalog candidate.
- Paths outside the catalog, repeated anchor paths, mismatched inspection, and malformed results fail the catalog contract.

Preserve every supplied lexical recommendation intersecting the exact expected evidence set. Any named catalog candidate intersecting that set must also appear in returned source paths. The deterministic grounded-answer verdict covers exact expected paths, abstention, recommendation preservation, and observable catalog-contract behavior. It is neither semantic answer judgment nor evidence of provider understanding.

Run model direct and catalog-assisted v3 three contemporaneous times per case against one sanitized repository snapshot and one explicit model, rotating arm order. Reuse v2's eight queries, expected paths, task types, request styles, lexical limit, and review status. Only the case-ID prefix changes for v3.

Retain all v2 acceptance requirements:

- At least six repeatable cases.
- Non-inferior pass count and exact expected-path recall versus model direct.
- At most 85% of model direct's observed tokens and 95% of its wall duration.
- No worse no-hit p95 or latency standard deviation than model direct.
- Zero provider-contract failures, catalog-contract failures, dropped relevant recommendations, or dropped relevant catalog candidates.

Failure of any criterion rejects v3. Bind the suite to the exact protocol digest. Use catalog format `repository_path_title_v1`, cap candidates at four, and cap serialized catalog size at 65,536 bytes.

## Privacy and failure meaning

Queries are checked-in public fixtures. Catalog paths and first headings come from the sanitized public corpus. Write raw answers only to owner-only operator output. Tracked reports exclude answer prose, source bodies, and absolute paths.

`provider_timeout`, `provider_result_invalid`, and `provider_execution_failed` retain the provider-boundary meanings from earlier runners. `catalog_contract_failed` means the structured assessment, catalog coordinates, or observable inspection relationship violated this decision. `relevant_recommendation_dropped` means an exact expected path supplied as a lexical anchor was omitted from returned sources. `relevant_catalog_candidate_dropped` means an exact expected path named from the catalog was omitted from returned sources. None changes production routing.

## Consequences

The repeated experiment rejected v3. Across 24 observations per arm, model direct passed 15 and v3 passed 11. V3 used 46.57% of direct tokens and 60.75% of direct duration, and passed both no-hit latency criteria. However, only three cases passed every repetition; v3 was inferior in pass count and recall and recorded one catalog-contract failure.

The catalog stabilized no-hit candidate selection but did not correct provider completeness judgments for hit bundles. Node-fleet architecture, cross-provider exact merge, and the execution specification were each missed in all three v3 repetitions while the provider usually declared the anchors complete. A path-title directory alone therefore cannot establish evidence completeness.

Do not activate v3. `lexical-v1` remains operational. Any later candidate must replace provider self-assessment with a deterministic, query-independent machine-side coverage mechanism or wait for human-reviewed ground truth. It must not route by question category, relax thresholds, or infer completeness from confidence. See the [redacted observation](../../evidence/search/catalog-assisted-v3.md).

## Verification

- Suite validation rejects protocol, corpus, catalog, request-style, lexical-result, and v2 ground-truth drift.
- Focused tests cover catalog bounds, source-body exclusion, candidate-path validation, and unchanged no-hit acceptance criteria.
- The repeated report must bind the suite, protocol, catalog, corpus, repository snapshot, provider, model, repetitions, privacy, and exact pre-registered criteria.
- Repository quality, tests, builds, documentation lifecycle, knowledge refresh, and release-completion checks remain required.
