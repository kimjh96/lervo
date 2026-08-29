# Linked-evidence provider-shadow pilot v15

## Result

V15 is rejected. It consumed one Codex invocation and zero Claude invocations, then stopped under the pre-registered unavailable-observation rule. Recovery made no provider call.

| Measure | Codex | Claude |
| --- | ---: | ---: |
| Authorized calls | 8 | 8 |
| Observed invocations | 1 | 0 |
| Valid observations | 0 | 0 |
| Unavailable observations | 1 | 0 |
| Recall or precision evidence | unavailable | unavailable |
| Duration or usage evidence | unavailable | unavailable |
| Provider gate | failed | incomplete |

The incomplete pair provides no v15 speed, token, or selection-quality comparison.

## Failure evidence

The first Codex turn was accepted and reached a failed terminal before any agent message. The durable attempt and no-call recovery preserve one invocation, one unavailable observation, unchanged primary effects, and a stopped experiment.

The provider-shadow record excludes raw output and unrestricted errors. A separate privacy-bounded classification of owner-local Codex terminal metadata found:

- error category `other`;
- 872 ms provider-session duration;
- no agent message;
- markers for invalid schema, response format, and `uniqueItems`; and
- no unsupported-model marker.

The excluded message has digest `sha256:294a6c023ad8dee81fa553e52f1829c55ee3aaf831ca493789ab35deb8aadf1c`. These markers identify schema compatibility; they neither reveal nor reclassify provider reasoning.

Execution also exposed a local recovery-validator omission for the new `psv15_` coordinate. The validator was extended only to materialize the consumed call as unavailable. It made no additional call and did not resume v15.

## Disposition

The shared schema used `uniqueItems: true` for generation-time duplicate exclusion. The strict provider-neutral parser separately rejects duplicate tokens with `duplicate_e4_marker`, making that generation keyword redundant. [ADR-0272](../../../decisions/search/activation/provider-shadow-structured/0272-remove-unsupported-structured-selection-unique-items.md) removes only the keyword and retains parser enforcement.

V15 remains immutable and rejected. A fresh paired successor requires its own reviewed contract, coordinates, and budget. Managed context, canary traffic, operational search, and activation remain unauthorized.

## Boundaries

- V14 is unchanged and rejected.
- No v15 attempt may be retried, repaired, replaced, or resumed.
- No Claude result may be inferred from its zero calls.
- Session duration is diagnostic metadata, not an eligible v15 latency observation.
- No raw prompt, provider output, source body, path, credential, billed cost, or unrestricted error is retained in this document.

## References

- [ADR-0271](../../../decisions/search/activation/provider-shadow-structured/0271-test-structured-codex-provider-shadow-carrier-v15.md)
- [ADR-0272](../../../decisions/search/activation/provider-shadow-structured/0272-remove-unsupported-structured-selection-unique-items.md)
- [Exact v15 overlay](../../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v15.json)
