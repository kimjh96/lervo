# ADR-0310: Pre-register lexical-v2 v13 confirmation

Status: `accepted`  
Date: 2026-08-31

## Context

V12 correctly rejected activation. Codex missed the unchanged duration gate and regressed the new knowledge-lifecycle holdout. Claude completed every answer with native structured output, but the common event boundary counted the SDK's successful end-turn `StructuredOutput` carrier as an ordinary tool call. A final Korean local run also exceeded the unchanged build-p95 ratio by 1.55%.

Claude Agent SDK 0.3.226 declares that a JSON Schema session ends with a successful `tool_result` carrier followed by the `structured_output` attachment containing the output. The installed native executable names that carrier `StructuredOutput`. It has no repository, shell, network, or user-owned side effect, but suppressing arbitrary tools or accepting an unverified carrier would weaken isolation.

Provider-free v12 inspection showed that every expected path was present in the candidate's first two documents. The extra two documents increased injected context and introduced competing current-status material in the failed Codex holdout.

## Decision

Create a fresh `lv2bench_provider_comparison.v13` confirmation. Preserve all twelve cases, three repetitions, two arms, models, common low effort, native schema, response protocol, maximum 72 invocations, and every v12 acceptance threshold exactly. Do not retry, replace, repair, or borrow any v12 result.

Make only these provider-neutral changes before a live call:

1. The Claude adapter may consume one completed `StructuredOutput` result as provider-native framing only when the session requested a JSON Schema result. Require the exact carrier name and a successful result, retain its input only as a digest, reject a failed carrier, and continue normalizing every other tool and command unchanged. Introduce no new canonical event: transport framing is not execution work. The same name without configured structured output remains an ordinary tool.
2. Limit candidate delivery to the first two query-ranked documents. Preserve complete Markdown sections, at most two sections per document, and the existing 3,000-byte target. Before calls, provider-free validation must prove that all expected paths remain supplied and candidate bytes are at most 70%.
3. Replace locale negotiation in lexical-v2 identifier lowercasing with deterministic Unicode default lowercasing only if differential tests prove identical terms across the checked corpus and multilingual edge fixtures. Increment the adapter implementation revision and rerun the unchanged English and Korean quality and cost gates. Reject the optimization if output differs or build p95 remains above three times lexical-v1.
4. Extract pure report evaluation from the provider execution entrypoint without changing report values. Before live calls, a deterministic fixture must prove byte-for-byte equivalent evaluation output.

Keep the carrier rule behind the Claude adapter. The evaluation runner must continue requiring zero normalized tool and command events from both providers and both arms. The adapter must not inspect case IDs, expected paths, task types, provider-comparison coordinates, or answers.

## Activation gates

Both providers must independently pass all v12 gates:

- Case-pass non-regression.
- Recall and precision non-inferiority.
- At least 27/36 candidate observations and nine of twelve cases passing every repetition.
- Candidate recall of at least 85% and precision of at least 50%.
- Complete native structured usage.
- Zero provider, contract, normalized-tool, and command failures.
- Candidate tokens at most 90% of baseline.
- Candidate duration at most 95% of baseline.
- Injected bytes at most 70% of baseline.

Local English and Korean suites must retain all original and challenge cases, candidate-only success in every task type, zero baseline-only success, and unchanged quality and cost limits. Any failure keeps lexical-v1 operational and lexical-v2 evaluation-only.

## Privacy and failure meaning

The consumed carrier stores no payload in canonical events; existing digests remain the only input observation. An unbound, duplicate, wrongly named, or failed result is not carrier success. It remains an ordinary normalized tool event or a provider error and fails the zero-tool contract. `structured_output` must pass through the existing closed result schema and must never be inferred from carrier input.

## Consequences

V12 evidence and frozen source digests remain immutable. V13 narrows context and corrects adapter classification at the provider boundary without lowering a threshold. The engine remains replaceable: search ranking, section delivery, result transport, and provider telemetry remain separate contracts usable by local-only, external-only, and composed retrievers.

## Verification

- Claude adapter differential and common provider-contract tests covering configured carrier success, absent configuration, wrong name, failure, duplicate or unbound result, arbitrary tool, and Bash command.
- Provider-free v13 expected-path, two-document, section, schema, invocation-ceiling, and byte checks.
- Unchanged English and Korean local quality and cost reports.
- Deterministic old/new report-evaluator equivalence.
- One fresh complete Codex report and one fresh complete Claude report; activate only if both decisions pass.
- Quality, build, full tests, documentation, knowledge lifecycle, release artifacts, and task-base release-completion checks.

## References

- [V12 pre-registration and result](0308-pre-register-lexical-v2-pipeline-activation-gates.md)
- [V12 rejection](0309-retain-lexical-v1-after-lexical-v2-v12-confirmation.md)
- [Earlier Claude framing classification](../activation/0260-classify-claude-structured-output-framing-provider-shadow-v7.md)
- [V12 evidence](../../../evidence/search/lexical-v2/lexical-v2-activation-confirmation-v12.md)
