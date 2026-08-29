# Linked-evidence shadow phase A registered-corpus pilot v2

Status: `observed_stopped`
Date: 2026-08-28

## Question

Can the two-pass population authorized by [ADR-0250](../../decisions/search/activation/0250-authorize-two-pass-registered-corpus-phase-a-pilot.md) complete the immutable phase A incidence, replay, bounds, and privacy gate while treating human-publication status separately from search eligibility?

## Bound preparation

The owner-only manifest `sha256:0c73958f89884f46cad626b9bac90e1bd783c6add69da2f07bcafdba5382466f` bound:

- isolated project `prj_ff904b15762c4e03`;
- 286 registered documents and corpus `sha256:f7335d801c59f7f32411cb2fa71d8c5872d332f818caf7994bee69bce96c2988`;
- contract `sha256:df5c1fee7fe80c1f9a407a807bd22b8d6dfe9cd43c881ddeee66e687e82ff423`;
- public v8 suite `sha256:28775d1126269ce42c961d15c3b7cd8deb5affe6f7e730678f223c0b6dfd2f20`;
- built CLI `sha256:6bc7402c04fa546b41bf9611cd3e483a3b20294249ef4b043d9cb0008d563514`;
- 30 scheduled primary runs;
- 30 possible semantic-publication evaluations; and
- a 60-invocation maximum.

Provider-free preparation found 24 nonempty projections. No provider call occurred before the manifest and workstream checkpoints were recorded.

## Execution result

Ordinal 1 completed as `run_7b8f338997d84983be35e74e786bb0de`. It created only `pilot-output-01.md`, passed project verification, emitted `run.completed`, and completed semantic-publication evaluation. Publication was blocked, so the CLI returned status 1, but the v2 eligibility rule accepted the search observation. Record `lshadow_6954735940e0eca6a6d58b47` retained all 6 candidates in 42,068 bytes without truncation.

Ordinal 2 started as `run_0d015a5b41614ac58d1f4ac9063eb011`. Its provider-visible turn contained the terse task but omitted the exact declared target `pilot-output-02.md`. After seeing the retained ordinal 1 output and verification suite, the provider identified `pilot-output-01.md` as current and attempted to modify it. The managed write bridge rejected the mismatched request with `contract_validation_failed`. The run emitted `run.failed`, not `run.completed`, and semantic-publication evaluation did not start. The controller stopped without retry, resume, or sample replacement.

Ordinal 2 context injection independently produced observed shadow record `lshadow_73e977291e7ab687133e939f`, retaining both candidates in 20,472 bytes without truncation. It is ineligible because the managed run did not complete.

## Review

Read-only review failed the pre-registered population gate:

| Measure | Result |
| --- | ---: |
| Eligible runs | 1 of 30 |
| Immutable observations | 2 |
| Nonempty projections | 2 |
| Unavailable observations | 0 |
| Replay mismatches | 0 |
| Privacy failures | 0 |
| Eligible-receipt provider invocations | 2 |
| Publication allowed | 0 |
| Publication blocked | 1 |
| Truncations | 0 |

The receipt count covers the eligible ordinal 1 primary and semantic calls. Canonical run events also prove that the ordinal 2 primary provider session started before failing; they do not establish an ordinal 2 semantic call.

## Diagnosis and boundary

This was not a linked-evidence calculation, replay, privacy, or publication-eligibility failure. The production-neutral orchestrator disclosed exact targets only for multi-file schedules. [ADR-0251](../../decisions/execution/orchestration/0251-declare-each-managed-write-target-to-provider.md) makes every managed target provider-visible while preserving the bridge as enforcement authority.

Pilot v2 is immutable and cannot be resumed or retried. It does not pass phase A and authorizes no provider-shadow or canary effect. A fresh 30-sample population would consume a new provider-call budget and requires explicit authority after verification of the target-delivery repair.

## References

- [ADR-0248: Stage linked-evidence reconciliation activation](../../decisions/search/0248-stage-linked-evidence-reconciliation-activation.md)
- [ADR-0250: Authorize two-pass registered-corpus phase A pilot](../../decisions/search/activation/0250-authorize-two-pass-registered-corpus-phase-a-pilot.md)
- [ADR-0251: Declare each managed write target to the provider](../../decisions/execution/orchestration/0251-declare-each-managed-write-target-to-provider.md)
- [Pilot v1 evidence](linked-evidence-shadow-phase-a-registered-pilot-v1.md)
- [Execution specification](../../specifications/execution.md)
- [Natural-language grounding quality roadmap](../../roadmap/natural-language-grounding-quality.md)
