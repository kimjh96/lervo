# ADR-0316: Pre-register lexical-v2 v19 provider-native warm admission

Status: accepted for evaluation only
Date: 2026-08-31

## Context

Codex v18 passed every gate with 36/36 candidate observations, 100% recall and precision, 79.28% of baseline tokens, 91.91% of baseline request duration, and 27.44% of baseline injected bytes. Claude v18 was not a valid model comparison: all 72 observations failed immediately, usage was absent, and Claude Agent SDK session logs identified `authentication_failed` while two isolated SDK processes overlapped.

The subscription-authenticated Claude Agent SDK cannot safely use Codex's rolling process preparation in this environment. Treating this provider boundary as a search failure or silently reverting to cold request startup would be incorrect.

## Decision

Create `lv2bench_provider_comparison.v19` without changing v18 cases, ordering, evidence, schema, protocol, model, reasoning effort, repetitions, invocation maximum, or acceptance thresholds.

Use a provider-native isolated preparation policy:

- Codex retains `rolling_isolated_prewarm`: prepare the next app-server process while the current isolated turn runs.
- Claude uses `serialized_warm_admission`: prepare exactly one SDK process to readiness, admit one isolated request, close it, and only then prepare the next. Claude provider processes must never overlap.

Both arms use the same strategy within each provider. Every observation records `providerPreparationStrategy` and `providerPreparationDurationMs`. Request duration starts after readiness; total preparation remains visible in the report. No context, response, thread, session, or provider process is reused across observations.

When a normalized provider turn fails, preserve its bounded `failureCode` through the evaluation failure result. Exclude diagnostic bodies; only the existing bounded code enters telemetry.

## Consequences

Provider lifecycle variation remains outside search and behind provider-neutral orchestration. An external search engine cannot select or alter the preparation strategy. Claude serial admission trades throughput for valid isolated warm-request latency. Deployments requiring concurrent Claude throughput need an independently authorized authentication mode and a separate comparison.

Lexical-v1 remains operational until fresh Codex and Claude v19 reports both pass every unchanged gate. V18's Claude authentication failure and Codex success remain immutable evidence and must not be combined with v19.

## Verification

- Failure-code propagation and preparation-strategy tests.
- Provider-free v19 suite validation and unchanged local capability results.
- Fresh sequential Codex and Claude v19 reports without retries.
- Full repository, documentation, knowledge, and release-completion checks before activation.
