# Paired provider-shadow pilot v2

Status: `failed`
Observed: 2026-08-29

## Outcome

The paired v2 pilot stopped after exactly two provider calls under its first-failure rule and is terminal and non-resumable. One Codex observation succeeded; the matching Claude observation was unavailable after the provider turn completed. The pilot failed its exact 48-observation gate and cannot support a provider winner, production activation, or a complete speed, token, or accuracy comparison.

Prepared manifest digest: `sha256:9125f75921e8b7af6d7ac1019cf699d2974dbe9704c8dd0888602e2162eebfac`.
Retained file digest: `sha256:3247ac80783d56cda1a5fc0b8826bf076cad9f1fb9e350ab28fbd03b6c282c08`.
Failed review file digest: `sha256:edcb0c50828396aa58ca1f651d18262963cf0449b9b3245425d98cc44e01ce16`.

## Bounded observations

| Provider | Model | Calls | Observed | Unavailable | Precision | Recall | Duration | Observed total tokens |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Codex | `gpt-5.6-sol` | 1 | 1 | 0 | 100.00% | 100.00% | 11.438 s | 42,902 |
| Claude | `opus` | 1 | 0 | 1 | N/A | N/A | N/A | N/A |

The Codex sample selected both reviewed relevant sources and no unexpected source. It reduced 14 candidate bodies totaling 97,037 bytes to two selected bodies totaling 9,427 bytes: an 85.71% source-count reduction and a 90.28% byte reduction. These are only potential downstream context savings; they did not reduce the completed selection call and are not billed-cost evidence.

Codex usage comprised 42,496 input, 11,008 cached-input, 406 output, and 267 reasoning-output tokens; the adapter reported 42,902 total tokens. Provider accounting categories can overlap and must not be summed independently.

Claude reached `turn_completed` with all durable coordinates present, then failed the aggregate result-validity boundary. The persisted bounded code is `provider_shadow_result_invalid`; raw model output was not retained. Tool activity, terminal state, result size, and strict parser rejection were not separately recorded, so the exact cause is unobservable and must not be inferred.

Both observations preserved primary context, output, managed writes, verification, publication, and E1-E4 event digests. Replay and privacy checks passed.

## Interpretation

The single Codex success is a harness observation, not a 24-sample accuracy estimate. Claude speed and token usage are unavailable; zero values in the failed machine review are absence sentinels, not measurements. No currency savings are claimed because billed-price evidence was not captured.

[ADR-0256](../../decisions/search/activation/0256-correct-claude-provider-shadow-observability-v3.md) preserves this result and defines a fresh successor with no Claude tools and bounded raw-free failure diagnostics.

## References

- [ADR-0255](../../decisions/search/activation/0255-authorize-paired-codex-claude-provider-shadow-v2.md)
- [Exact v2 contract](../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v2.json)
- [Provider-shadow v1 evidence](linked-evidence-provider-shadow-pilot-v1.md)
