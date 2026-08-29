# Claude structured-selection provider-shadow v5

Status: `stopped_rejected`
Date: 2026-08-29

## Result

V5 prepared three fresh Claude-only samples but stopped after the first accepted provider invocation. The Claude turn reached `turn_completed`; no primary context, output, managed-write, verification, publication, or E1-E4 effect changed. The execution controller then failed while constructing the bounded unavailable observation because its identifier validator allowed only `psv2` through `psv4` coordinates.

The no-call recovery path preserved one unavailable observation, and the exact review failed as required. Durable state records one Claude invocation, zero eligible observed results, one unavailable result, zero privacy failures, and zero primary-effect differences. No retry, replacement, Codex call, canary action, or production action occurred.

## Evidence boundary

The storage failure occurred after the in-memory provider outcome was classified but before its bounded `providerFailureCode` was persisted. The recovery record therefore reports `provider_shadow_attempt_state_invalid`; it cannot distinguish a missing SDK structured result from an invalid structured token selection. Raw provider output was intentionally neither retained nor reconstructed.

V5 consequently proves neither Claude structured-selection compatibility nor incompatibility. It provides no eligible accuracy, duration, token, cost, or compression measurement and cannot be combined with prior Codex evidence.

Prepared manifest digest: `sha256:e269d2848d116ad93d7001098e71b2af542c81402740ffa5261e7a729b592cf0`.

Recovered observation digest: `sha256:b3b3091af6d6de9f65ed751027e2333b9ce9bb2011e8aaa99b9230541a85ef94`.

## Disposition

V5 remains immutable and rejected. A successor must use fresh coordinates and cases, persist the bounded provider outcome before observation construction, retain the same strict JSON Schema and accuracy gates, and remain fail-first without retries.

## References

- [Exact v5 contract](../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v5.json)
- [ADR-0258](../../decisions/search/activation/0258-correct-claude-structured-selection-provider-shadow-v5.md)
- [V4 final report](linked-evidence-provider-shadow-pilot-v4.md)
