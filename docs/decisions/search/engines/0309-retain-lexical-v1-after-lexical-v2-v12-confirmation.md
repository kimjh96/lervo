# ADR-0309: Retain lexical-v1 after lexical-v2 v12 confirmation

Status: `accepted`  
Date: 2026-08-31

## Context

ADR-0308 froze a stronger lexical-v2 ranker, bounded section-evidence pipeline, common native structured-output carrier, matched provider effort, and twelve-case confirmation suite. After a v12 provider call, it prohibited implementation, protocol, query, expected-path, and threshold changes. Activation required independent Codex and Claude passes.

Provider-free selection and augmented local quality gates passed. A final local rerun exposed Korean build-tail variability above the unchanged cost bound. Fresh Codex and Claude confirmations each completed 72 invocations without retries, but neither produced an activation-eligible passing report.

## Decision

Reject lexical-v2 build `sebuild_f80913229c9023d3d74ddc9a`. Keep `lexical-v1` operational and as the explicit local rollback. Retain lexical-v2 only as evaluation infrastructure.

The frozen Codex report failed two gates: candidate duration was 97.02% of baseline, exceeding the 95% maximum, and the new knowledge-lifecycle status case regressed from 3/3 baseline passes to 1/3 candidate passes. Its 15.09% token reduction, 22.22-point recall gain, 20.83-point precision gain, and 37.65% injected-byte ratio do not supersede either failure.

The frozen Claude report passed the relative recall, precision, token, duration, byte, and provider-error measurements. It failed the common zero-tool and provider-contract gates on every observation because native structured-output activity appeared as one completed tool call, symmetrically on both arms. Under the frozen contract, this is a provider-boundary incompatibility and cannot be reclassified after observation.

See the complete [lexical-v2 activation confirmation v12](../../../evidence/search/lexical-v2/lexical-v2-activation-confirmation-v12.md).

## Consequences

- Production search selection, activation-transition, and rollback records remain unchanged.
- Do not reduce a threshold, remove a case, or retry a v12 call.
- The earlier eight-case v11 Codex pass remains development evidence; it cannot activate a candidate after those cases informed iteration.
- External-only replacement, local-plus-external augmentation, and bounded external reranking remain valid architectural modes, but this experiment activates none of them.
- Any successor must use a new preregistered confirmation revision and resolve three independent blockers: deterministic canonical current-source selection, fresh Codex duration at or below 95% of baseline, and provider-neutral telemetry distinguishing a native output carrier from an authorized repository or execution tool.
- The successor must reproducibly bound local build p95. The final Korean rerun reached 3.05 times baseline against the unchanged 3.00-times limit.
- The comparison runner is a long orchestration entrypoint. Splitting provider execution from pure report evaluation after v12 would change a frozen source digest and risk invalidating the exact report coordinate. A responsibility-preserving extraction is therefore limited to the successor revision, where deterministic fixtures must prove byte-for-byte report equivalence before a new live call.

## Verification

- English local report `spreport_60050d56ea252fc1843bdc1a`: passed.
- Korean local quality report `spreport_a592322985b508179a67922f`: passed. Final rerun `spreport_3894a24883dce5d074682e02` retained quality but failed the build-p95 cost bound.
- Provider-free v12 expected-path, four-document, structured-schema, and 37.65% byte checks: passed.
- Codex v12: completed; decision failed.
- Claude v12: completed; decision failed.
- Repository quality, document lifecycle, knowledge lifecycle, release-completion, and provider common-contract results are recorded in the task workstream.

## References

- [Frozen gates](0308-pre-register-lexical-v2-pipeline-activation-gates.md)
- [Replacement and composition](0306-separate-search-engine-replacement-and-composition.md)
- [Search and context boundaries](../../../architecture/search-and-context.md)
