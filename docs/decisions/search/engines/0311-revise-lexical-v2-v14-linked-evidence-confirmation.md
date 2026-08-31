# ADR-0311: Revise lexical-v2 v14 linked-evidence confirmation

Status: `accepted`  
Date: 2026-08-31

## Context

The v13 provider-free gate ran before model invocation and failed expected-path coverage. The unchanged fuzzy-merge case requires ADR-0180 and ADR-0187. Ranking selected ADR-0180 and directly relevant ADR-0227; ADR-0227 explicitly linked to ADR-0187, but the two-document slice discarded that authority. All 11 other cases retained their expected paths. V13 injected only 20.05% of baseline bytes, so bytes were not the blocker.

A fixed two-document limit is too narrow when authority is split between a conflict-resolution rule and a linked exact-merge boundary. Removing ADR-0187, replacing it with ADR-0227, or promoting an expected path in code would weaken or leak the frozen case.

## Decision

Reject v13 without provider calls. Create `lv2bench_provider_comparison.v14` with two ranked anchors, one linked expansion, one focused-specification candidate, and at most three delivered documents. Preserve complete-section delivery and the existing targets of two sections and 3,000 bytes per document.

Preserve every v12/v13 case, repetition, model, effort, native schema, protocol instruction, invocation ceiling, and acceptance threshold exactly. The candidate must remain at or below 70% of baseline injected bytes and 90% of tokens; allowing a third document does not relax either efficiency gate.

Prohibit live calls until provider-free selection proves all expected paths, the three-document bound, the structured schema, and the byte gate. The only implementation changes under test remain the v13 adapter carrier correction, semantically identical identifier optimization, and pure report evaluator.

## Consequences

V13 remains a recorded fail-fast result and cannot be relabeled. V14 tests a general graph-backed retrieval property: explicit canonical links may complete evidence that lexical ranking alone cannot fit within two documents. The selector receives no case identity, expected path, task type, provider identity, or answer.

## Verification

- Verify provider-free v14 expected-path, document, and byte gates.
- Verify the exact local English and Korean v13 ranker reports and unchanged cost gates.
- Run Claude structured-carrier and provider common-contract tests.
- Produce fresh, complete Codex and Claude v14 reports without retries or borrowed observations.
- Run full repository, documentation, knowledge, and release-completion checks.

## References

- [V13 pre-registration](0310-pre-register-lexical-v2-v13-confirmation.md)
- [V12 rejection](0309-retain-lexical-v1-after-lexical-v2-v12-confirmation.md)
