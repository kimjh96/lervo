# ADR-0312: Pre-register lexical-v2 v15 authority-preserving confirmation

Status: `accepted`  
Date: 2026-08-31

## Context

V14 completed all 72 invocations per provider without retries and rejected activation. Codex reduced tokens to 82.41% and injected bytes to 30.35%, but duration was 97.16%; fuzzy merge passed 0/3, and the knowledge-lifecycle holdout regressed from 3/3 to 0/3. Claude reduced tokens to 52.89% with zero normalized tools or commands, proving the structured-output carrier correction, but duration was 100.78%. It had provider errors in seven baseline and four candidate observations, only six candidate cases passed every repetition, and several cases regressed.

These failures reveal delivery defects, not missing retrieval. Fuzzy merge received ADR-0180, ADR-0227, and the expected linked ADR-0187, but both providers cited only the self-contained intermediate ADR-0227. The lifecycle holdout received its expected specification first, but section selection kept only its title and Scope. Without the Ordered stage convergence section needed to answer completion order, Codex abstained in all repetitions and Claude once.

## Decision

Create `lv2bench_provider_comparison.v15`. Preserve all cases, expected paths, three repetitions, two arms, models, low effort, native schema, the 72-call maximum, and every acceptance threshold unchanged.

Before live calls, apply four general changes:

1. Discover links from two anchors, place one explicit linked authority before secondary lexical anchors, and limit the final candidate to two documents. This preserves a primary source and its declared authority without exposing expected paths or case metadata.
2. Deliver the complete first-ranked canonical document when its UTF-8 body is at most 8,192 bytes. For larger primaries and every secondary document, retain bounded complete-section selection. This prevents a short authoritative specification from losing its completion procedure.
3. Revise the common response instruction to cite every supplied path materially required by the answer, up to the existing two-path maximum, and not cite related background. Preserve the closed result schema and 400-character answer limit.
4. Add `providerErrorCounts` to every evaluation observation as an exact map from existing normalized `provider.error.payload.failureCode` strings to positive counts. Store no diagnostics or provider payloads. Every count still contributes to `providerErrors` and fails the unchanged zero-error gate; the field diagnoses rather than forgives failure.

Run Codex and Claude sequentially so local process contention cannot confound within-provider duration. Do not retry, repair, replace, or borrow v14 observations.

## State, privacy, and failure meaning

`providerErrorCounts` is evaluation evidence, not a new canonical execution event. Its keys are existing bounded failure codes, and its values count events observed before the matching completed turn. An empty map means no provider error was observed. Any non-empty map makes the observation activation-ineligible even if the provider later returns an answer. Reports continue to exclude answers, diagnostic digests, source bodies, absolute paths, and provider payloads.

The full-primary rule uses only rank, canonical source bytes, and a fixed byte limit. Link priority uses only checked canonical Markdown links. Neither receives provider identity, task type, case ID, expected paths, or answer results.

## Activation gates

Keep the v12 gates exact. Each provider independently requires case non-regression; recall and precision non-inferiority; at least 27/36 candidate passes; nine cases passing all repetitions; at least 85% recall and 50% precision; complete usage and native structured output; zero provider, contract, tool, and command failures; a token ratio no greater than 90%; a duration ratio no greater than 95%; and an injected-byte ratio no greater than 70%. Local English and Korean quality and cost gates remain unchanged.

## Consequences

V14 remains immutable rejection evidence with report SHA-256 values `cc3373851f3ab866f63dd4dc44708f8ff95dc16da1b5ed89d6f2129ea3987628` for Codex and `ea6d652940d119ef70a9f06f157ae90789d2d9a0227c903ebabc8287a89f46a5` for Claude. V15 is a new confirmation, not a reinterpretation. Lexical-v1 remains operational until both v15 reports pass.

## Verification

- Test link-before-secondary ordering without expected-path input.
- Test the full-primary byte bound and fallback section behavior.
- Test provider error-code aggregation and privacy.
- Verify provider-free expected-path, two-document, and byte gates.
- Verify unchanged local English and Korean reports.
- Produce fresh sequential Codex and Claude v15 confirmations.
- Run full quality, type, test, documentation, knowledge, release-artifact, and task-base completion checks.

## References

- [V14 pre-registration](0311-revise-lexical-v2-v14-linked-evidence-confirmation.md)
- [V13 pre-registration](0310-pre-register-lexical-v2-v13-confirmation.md)
- [V12 rejection](0309-retain-lexical-v1-after-lexical-v2-v12-confirmation.md)
