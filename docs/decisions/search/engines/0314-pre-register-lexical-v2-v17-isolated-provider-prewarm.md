# ADR-0314: Pre-register lexical-v2 v17 isolated provider prewarm

Status: accepted for evaluation only
Date: 2026-08-31

## Context

V16 completed fresh sequential Codex and Claude comparisons without retries and rejected activation. Codex achieved 33/36 candidate observations, 91.67% recall, 86.11% precision, 77.18% of baseline tokens, and 96.87% of baseline duration. Claude achieved 35/36, 100% recall, 84.72% precision, 60.92% of baseline tokens, and 96.13% duration. Claude's recovered native structured-output path reduced provider errors from v15's nine observations to zero. Its remaining contract failure was a 406-character answer against the unchanged 400-character limit.

For both providers, reducing injected bytes to 30.16% did not reliably improve end-to-end request latency by five percent while each observation synchronously started a provider process. This fixed process preparation is provider infrastructure rather than search-engine work and dominates the paired request path.

## Decision

Create `lv2bench_provider_comparison.v17` without changing any case, expected path, repetition, arm ordering, model, reasoning effort, evidence delivery, invocation maximum, or acceptance threshold.

1. Prewarm the next provider process while the current isolated observation runs. Both arms use the same rolling preparation policy. Every observation still receives a new provider session or Codex thread, unique run and turn identities, and the same arm-specific workspace. No prompt, context, response, or cache state may cross observations.
2. Start request-duration measurement only after leasing the prepared provider client. Record `providerPreparationDurationMs` on every arm result rather than hiding preparation work. Preparation remains runtime-readiness telemetry but is not repeated on the critical request path in the evaluated operational design.
3. Remove v16's minimal provider base-instruction override. Retain protocol v8, including canonical-current-source and two-boundary citation rules, to restore v15 Codex quality behavior without provider-specific instructions.
4. Replace the native result schema with a stricter compatible schema setting `answer.maxLength` to 400 and `sourcePaths.maxItems` to two. Keep the post-response contract as an independent check.
5. Preserve v16's Claude structured-output recovery semantics: an intermediate failed `StructuredOutput` carrier is pending transport state; a terminal missing carrier remains a provider failure.

## Consequences

The speed gate remains 9,500 basis points. V17 changes the runtime, not the threshold, and reports cold preparation separately from steady-state request latency. Implementations unable to maintain an isolated warm client remain eligible for explicit cold-start operation but cannot claim the v17 latency result.

Rolling preparation is provider-neutral orchestration. It does not enter the search ports; external-only, augmented, and reranking engines use the same provider lifecycle. Failed preparation or a mismatched provider session fails closed and cannot silently fall back to an unprepared or different engine path.

Lexical-v1 remains operational until fresh Codex and Claude v17 reports both satisfy every unchanged acceptance criterion and a separate reviewed activation transition is recorded.

## Verification

- Validate the provider-free suite, selection coverage, byte bound, protocol digest, schema digest, and preparation mode.
- Test that adapters and runners isolate prepared clients, forward the exact-bound schema, and retain preparation telemetry.
- Produce fresh sequential Codex and Claude reports without invocation retries.
- Complete quality, type, test, documentation, knowledge-lifecycle, and release-completion checks before activation.
