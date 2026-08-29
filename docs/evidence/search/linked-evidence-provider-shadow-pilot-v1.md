# Linked-evidence provider-shadow pilot v1

Status: `observed_failed`
Date: 2026-08-28

## Question

Can one effect-free Codex selection turn for each of the 24 immutable nonempty phase-A v3 projections meet the recall, precision, replay, privacy, and no-primary-effect gates pre-registered by [ADR-0253](../../decisions/search/activation/0253-pre-register-effect-free-provider-shadow-pilot.md)?

## Bound preparation

Provider-free preparation reproduced all 24 authorized samples from the v3 manifest. It bound owner-only manifest `sha256:06544699c28066d1de3a4e60d14fc0a26250f86e1988416e9f90d2088a6120e9` and schedule digest `sha256:c41b382e71f386fc056213ffd9029a9fd500cc437a3831af984d241c32ef4f52`.

Every reviewed expected path was exposed. The observed maxima—16 candidates and 130,302 provider-visible source bytes—exactly matched the contract and stayed below the independent 262,144-byte ceiling. Preparation made no provider calls and bound explicit user authority from workstream revision 149.

Before the first provider call, full repository verification passed: code quality and structure, natural-language contracts, typecheck and build, 369 test files with 2,016 tests, release artifact and distribution smoke checks, 267 documentation lifecycle checks, and task-base release completion.

## Execution result

Initial local adapter-start validation failed because the harness generated noncanonical run and session ID prefixes. It made no provider invocation. After correction, the local contract, quality, and task-base release checks passed again.

Ordinal 1 completed one Codex `gpt-5.6-sol` selection turn. The controller then stopped before ordinal 2 with `provider_shadow_result_invalid`, retaining the one-invocation failure record. It attempted no retry, replacement, repair turn, answer turn, semantic-publication call, or later sample.

The failure was a harness identity-boundary defect. Candidate delivery translated registered corpus `sourceId` values into adapter `documentId` values, but result parsing searched the original corpus records for `documentId`. Consequently, every recognized token appeared unknown.

Bounded post-stop reconstruction of the exact retained provider session found a 237-byte result with digest `sha256:93652a66d45ca5ad62f7d5a091828c75cfc4af61bf087cd99d7337bb3545f682`. Correcting only the identity-field lookup accepted two exact standalone tokens: the two human-reviewed relevant sources. Ordinal 1 therefore had reconstructed recall and precision of 100%, with no prose or token-contract violation.

Observed usage was 42,989 total tokens: 42,676 input, 11,008 cached input, 313 output, and 174 reasoning-output tokens. These values are observed usage, not billed-cost claims.

The reconstruction is owner-only forensic evidence, not a canonical pilot observation. Before rejecting the result, the stopped process had not persisted its randomly generated shadow run, local session, target turn, adapter receipt, or adapter duration coordinates. The forensic record cannot replace the required immutable observation or make the pilot pass.

## Review

| Measure | Result |
| --- | ---: |
| Prepared samples | 24 |
| Provider invocations | 1 |
| Canonical observations | 0 |
| Invalid results recorded by controller | 1 |
| Retried or replacement samples | 0 |
| Remaining provider calls attempted | 0 |
| Post-stop corrected ordinal-1 recall | 100% |
| Post-stop corrected ordinal-1 precision | 100% |

Post-stop read-only comparison found the primary context event set, output, repository status, verification state, publication state, and E1-E4 event set unchanged. This supports the no-effect boundary but does not repair the missing canonical observation.

## Boundary and next decision

Provider-shadow v1 is rejected without retry or threshold change. It proves neither the 24-sample selection-quality gate nor provider use and authorizes no managed-context change, canary traffic, or production activation.

The first response is a positive but bounded signal: after correcting only the harness identity lookup, the provider selected both reviewed sources and nothing else.

A successor requires a new contract and explicit authority. It must preserve v1, use one identity shape across delivery and parsing, persist a bounded unavailable record before rejecting any completed call, prove non-resumability after every stopped execution state, and use a fresh population. It must not reuse this provider result as an observation.

## References

- [ADR-0253: Pre-register an effect-free provider-shadow pilot](../../decisions/search/activation/0253-pre-register-effect-free-provider-shadow-pilot.md)
- [Provider-shadow v1 contract](../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v1.json)
- [Phase-A pilot v3 evidence](linked-evidence-shadow-phase-a-registered-pilot-v3.md)
- [Natural-language grounding quality roadmap](../../roadmap/natural-language-grounding-quality.md)
