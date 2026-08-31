# ADR-0317: Pre-register lexical-v2 v20 five-repetition confirmation

Status: accepted for evaluation only
Date: 2026-08-31

## Context

After Claude authentication was restored, the fresh v19 Claude report passed every unchanged quality, accuracy, token, duration, byte, provider, tool-isolation, schema, and preparation gate. The v19 Codex report retained perfect candidate quality and used 79.19% of baseline tokens and 27.44% of baseline injected bytes, but used 97.75% of baseline duration and therefore failed the unchanged 95% duration gate. One candidate observation took 39.603 seconds while the other 35 candidate observations totaled 383.681 seconds. The report remains a failure; removing that observation, substituting the earlier v18 Codex pass, or combining different suite revisions is prohibited.

Three repetitions leave a single provider-latency outlier with enough weight to reverse the aggregate duration decision. The benchmark needs a larger preregistered sample, not a weaker gate or an observation retry.

## Decision

Create `lv2bench_provider_comparison.v20` before any v20 provider call. Inherit v19 cases, queries, expected paths, corpus boundaries, ranking build, evidence pipeline, protocol, response schema, execution workspaces, reasoning effort, arm ordering, provider-native isolated preparation, models, and every ratio, quality, contract, and error threshold.

- Increase repetitions per arm from three to five and the corresponding invocation maximum from 72 to 120.
- Scale the minimum candidate passed-observation floor from 27/36 to 45/60, preserving the 75% requirement.
- Keep the case floor at 9/12 because it counts cases passing every repetition, not observations.
- Compute the duration decision from every observation's untrimmed total; do not discard, winsorize, retry, or replace outliers.
- Run Codex and Claude sequentially from the same frozen repository state.
- Require both fresh v20 reports to pass every criterion for activation.
- Treat a provider authentication or readiness failure as invalidating that provider report rather than weakening the policy.

## Consequences

V20 increases cost and elapsed verification time by two thirds, but gives transient provider latency less leverage while making repeated quality consistency stricter. The 5% duration improvement, 10% token improvement, 30% byte-reduction minimum, absolute quality floors, zero provider errors, zero tool activity, and zero contract failures remain unchanged.

Lexical-v1 remains operational until both v20 reports pass and a separate activation-qualification decision is recorded. V18 and v19 reports remain immutable diagnostic evidence and are not inputs to the v20 decision.

## Verification

- Contract tests must prove that v20 changes only repetition counts, the invocation bound, and the proportionally scaled observation floor.
- Provider-free selection must pass before provider calls.
- Produce one fresh Codex report and one fresh Claude report without observation retries.
- Complete local capability, quality, type, test, documentation, knowledge-lifecycle, and release-completion checks before activation qualification.
