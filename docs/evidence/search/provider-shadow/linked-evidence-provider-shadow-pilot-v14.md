# Request-scoped claim-coverage provider-shadow v14

Status: `rejected`
Date: 2026-08-29

## Result

V14 used exactly 16 authorized fresh paired calls across two diagnosed cases and four repetitions. The first 15 calls produced valid observations. The final Codex call completed but violated the exact-token carrier with bounded code `provider_shadow_prose_present`. Recovery counted the completed call once, made no additional provider calls, materialized the unavailable observation, and stopped the pilot.

Claude produced eight valid observations and passed its selection gates with 100% recall, 68.75% mean precision, and 50% minimum precision. Codex produced seven valid observations with 100% recall and precision, but its unavailable eighth observation failed the zero-unavailable and zero-grammar-failure gate. V14 is rejected without retry or threshold changes and authorizes no four-case confirmation, managed context, canary, or activation.

## Provider measurements

| Provider | Valid | Unavailable | Mean duration | Recall | Mean precision | Minimum precision | Total tokens | Selected bodies | Body-byte reduction | Gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Codex | 7 | 1 | 14.978 s | 100% on valid | 100% on valid | 100% on valid | 300,017 | 56,608 of 645,914 bytes | 91.24% | Failed unavailable grammar result |
| Claude | 8 | 0 | 47.442 s | 100% | 68.75% | 50% | 383,938 | 130,924 of 731,836 bytes | 82.11% | Passed provider gates |

Across the seven fully valid pairs, Codex took 104.843 seconds and Claude took 338.278 seconds. Claude was 3.2265 times slower and reported 14.44% more total tokens on the same seven source samples. Provider-reported token estimates are neither billing data nor directly comparable across providers.

## Case evidence

| Case | Codex | Claude |
| --- | --- | --- |
| `implementation_release` | Four exact two-source selections at 100% recall and precision | Four three-source selections at 100% recall and 66.67% precision |
| `boundary_fuzzy_merge` | Three valid exact two-source selections at 100% recall and precision; repetition four unavailable after carrier prose | Four valid observations at 100% recall; 70.84% mean precision; 12 selections with four unexpected |

The request-scoped protocol removed every unexpected Codex selection in the seven valid observations. Claude remained at or above the 50% minimum-precision boundary: release observations were consistently 66.67%, and fuzzy-merge precision ranged from 50% to 100%. This is diagnostic evidence, not an activation result, because the final Codex grammar failure makes the pilot fail closed.

## Failure and accounting

The prepared manifest digest is `sha256:1b41178ef32ad7f63164fd25c8b3488f9fb42c95567e13b877e460bcb73899f1`. The stopped unavailable observation digest is `sha256:d084c49b293fc57c075591525f4298122a2c817868440c5272bfab24c3a6bca8`.

The failure path retained no raw provider output. A recovery precondition initially rejected the v14 observation identifier because its bounded parser allowed only earlier version prefixes. A separately checkpointed correction extended validation through v14 and allowed recovery to accept either a pre-counted completed call or the immediately preceding durable turn without double-counting. Recovery then made zero calls and preserved final accounting at eight Codex and eight Claude invocations.

Across v2-v14, 137 provider calls occurred against a cumulative authorization ceiling of 203. The 66 unmade calls are 32.51% of that ceiling. No billed-cost saving is claimed.

V14 is immutable and rejected. Before any new provider call, a successor requires a separately reviewed, provider-neutral diagnosis of the Codex carrier-prose violation. It cannot retry or repair this observation.

## References

- [ADR-0269](../../../decisions/search/activation/0269-test-request-scoped-claim-coverage-v14.md)
- [V13 redundancy diagnosis](linked-evidence-provider-shadow-v13-redundancy-diagnosis.md)
- [V13 evidence](linked-evidence-provider-shadow-pilot-v13.md)
- [Exact v14 overlay](../../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v14.json)
- [Combined measurement report](../codex-claude-linked-evidence-measurement-report.md)
