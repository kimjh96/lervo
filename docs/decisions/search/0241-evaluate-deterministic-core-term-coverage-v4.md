# ADR-0241: Evaluate deterministic core-and-term coverage v4

Status: `accepted`

## Context

Catalog-assisted v3 improved efficiency and no-hit stability but still let the provider declare plausible lexical anchors complete. It therefore missed the Node architecture, cross-provider exact merge, and execution specification in every repetition.

The next candidate must replace that declaration with deterministic machine-side coverage, apply one rule to every query rather than route by question category, preserve the prior ground truth and thresholds, and remain evaluation-only.

## Decision

Pre-register `core-term-assisted-v4`. Supply the unchanged top three `lexical-v1` bodies; three fixed canonical core sources (`README.md`, `docs/architecture/system.md`, and `docs/specifications/execution.md`); and the top lexical body for each of at most eight distinct ASCII query terms. Deduplicate sources, retain query-term order, and cap non-lexical injected bodies at 98,304 bytes. The fixed core is query-independent. Term extraction and top-one retrieval must use one deterministic rule for every case. No provider field may claim completeness.

When `lexical-v1` returns no documents, also supply v3's deterministic all-source path-title catalog. Require one to four named catalog candidates and observable read-only inspection. The catalog is candidate metadata, not evidence. Hit bundles must return an empty no-hit inspection.

Preserve every relevant lexical recommendation, deterministic coverage source, and named no-hit candidate. The deterministic grounded-answer verdict covers exact expected paths, abstention, preservation, and observable no-hit inspection; it is neither semantic answer judgment nor evidence of provider understanding.

Run model direct and v4 contemporaneously three times per case against one sanitized repository snapshot and one explicit model, rotating arm order. Reuse v3's eight queries, exact expected paths, task types, request styles, lexical limit, review status, and quality and resource thresholds. Add zero thresholds for failed coverage contracts and dropped relevant deterministic coverage sources or no-hit candidates. Failure of any criterion rejects v4.

## Privacy and failure meaning

Queries are checked-in public fixtures. Fixed and term-selected bodies use the existing exact-hash managed benchmark envelope. Raw answers remain owner-only operator output. Tracked reports exclude answers, source bodies, and absolute paths.

`coverage_contract_failed` means deterministic source construction, hit/no-hit result shape, catalog coordinates, or the observable no-hit inspection relationship violated this proposal. `relevant_coverage_source_dropped` means an exact expected path supplied by fixed core or term coverage was omitted from returned sources. `relevant_no_hit_candidate_dropped` means an exact expected path named from the no-hit catalog was omitted. Existing provider failure meanings remain unchanged. None changes production routing.

## Consequences

The repeated experiment rejected v4. Across 24 observations per arm, v4 passed 16 and model direct passed 15. V4 achieved 81.25% recall versus 70.83%, used 58.27% of direct wall duration, and passed both no-hit latency criteria. However, only four cases passed every repetition. Two provider-contract failures made token observations incomplete, three coverage contracts failed, and the provider twice omitted the deterministically injected exact-merge ADR.

Fixed core coverage repaired the Node architecture and execution-specification failures, but deterministic delivery did not produce repeatable reference. Do not activate v4; `lexical-v1` remains operational. Human review remains required before provenance promotion, production-quality claims, or activation. The rejected experiment is a negative reproducible baseline and cannot authorize threshold relaxation, category routing, confidence-as-completeness, silent managed provider calls, or fixture-specific fixed sources. See the [redacted observation](../../evidence/search/core-term-assisted-v4.md).

## Verification

- Suite validation rejects protocol, corpus, deterministic coverage, request-style, lexical-result, and v3 ground-truth drift.
- Focused tests cover fixed-core selection, term deduplication and bounds, source-body delivery, no-hit catalog inspection, preservation, and unchanged acceptance thresholds.
- The repeated report must bind suite, protocol, coverage policy, corpus, repository snapshot, provider, model, repetitions, privacy, and exact pre-registered criteria.
- Repository quality, tests, builds, documentation lifecycle, knowledge refresh, and release-completion checks remain required.
