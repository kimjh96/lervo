# Linked-evidence shadow phase A registered-corpus pilot v1

Status: `observed_stopped`
Date: 2026-08-28

## Question

Can the isolated registered-corpus population authorized by [ADR-0249](../../decisions/search/activation/0249-authorize-isolated-registered-corpus-phase-a-pilot.md) supply the immutable phase A observation set required by [ADR-0248](../../decisions/search/0248-stage-linked-evidence-reconciliation-activation.md) without changing this repository's operational search or managed context?

## Bound preparation

The owner-only prepared manifest `sha256:740636c9b0435e34a3ee5885e0110f88eeb3f51a9533aceb07142bc0b9aa2f1f` bound:

- isolated project `prj_4a4422a9ff144d58`;
- 286 registered Markdown documents and corpus `sha256:f7335d801c59f7f32411cb2fa71d8c5872d332f818caf7994bee69bce96c2988`;
- public v8 suite `sha256:28775d1126269ce42c961d15c3b7cd8deb5affe6f7e730678f223c0b6dfd2f20`;
- pilot contract `sha256:0432d01c5cf3e78a15bf17dc7500bd4c1973ec1baceb1d38b325427f16760425`;
- built CLI `sha256:6bc7402c04fa546b41bf9611cd3e483a3b20294249ef4b043d9cb0008d563514`; and
- 30 exact public-query runs with distinct output paths and verification suites.

Provider-free dry replay found 24 scheduled nonempty projections. Each of the four Node-fleet repetitions had 19 linked candidates and the same bounded retained prefix of eight. No provider call occurred during preparation. The result exceeded the minimum incidence precondition.

## Execution result

The controller started ordinal 1, `drv8case_implementation_release`, and stopped when the CLI returned nonzero. It did not start ordinals 2 through 30, retry, or replace the failed sample.

The primary managed execution nevertheless completed:

| Coordinate | Observation |
| --- | --- |
| Run | `run_2a0f86fb3e914a91ad2504577367f81f` |
| Managed change | created only `pilot-output-01.md` |
| Project verification | `passed` |
| Run event | `run.completed` |
| Shadow record | `lshadow_b0b836822f62d879151ff83f`, status `observed` |
| Shadow projection | 3 recommendations, 6 candidates, 6 retained, 42,068 bytes, not truncated |
| Privacy inspection | no query, absolute pilot root, or registered source path in the observation |
| Deterministic replay | exact after canonical object-key normalization |

The controller rejected the sample because writing publication was blocked. Evaluation artifact `art_d54ecf612370215e1accd73f1ca46ccb87e26a8a49e2abfef8f15ea3b759149d` records a separate-pass Codex semantic evaluator: `natural_en_prose` passed, `plain_audience_language` failed with two violations, and `direct_result_and_action` failed with one. Existing managed-run behavior retained the verified file change and shadow observation, but denied CLI success and publication.

## Diagnosis

The pilot pre-registration incorrectly assumed machine presentation eliminated semantic writing evaluation. The canonical [execution specification](../../specifications/execution.md) requires managed runs to use a machine-result protocol and then invoke a separate read-only session of the selected provider for human-facing publication. Failure blocks CLI success without reverting an already verified file change. [ADR-0015](../../decisions/execution/orchestration/0015-lervo-run-cli-vertical-slice.md) defines the same production sequence.

The pilot's prohibition on an answer-quality provider call and expectation of one provider turn per sample were therefore incompatible with production `lervo run` before ordinal 1 began. Continuing would violate the approved call and stop contract. Counting this shadow record toward a replacement 30-run set would violate the no-retry population rule.

The replay review initially compared retained-coordinate objects using raw JSON key order, which could report a false mismatch despite equal values and ordered retained sources. It now canonicalizes object keys, preserves array order, and has focused regression coverage. This defect did not cause the provider stop, but would have invalidated final review.

## Result and next boundary

Pilot v1 failed the phase A collection gate: it produced one primary managed execution and one valid immutable shadow observation, but zero controller-accepted samples in the pre-registered 30-run set. It demonstrates sufficient linked-evidence incidence for this isolated corpus and shows that the first observation is private and replayable. It does not complete phase A or authorize provider-shadow or canary context effects.

A replacement population requires a new reviewed decision and user authority. The recommended approach preserves production writing-publication behavior, budgets both the primary task and mandatory separate semantic publication evaluation for every sample, defines whether publication-blocked but `run.completed` observations are eligible, and binds the total provider-call and stop policy before deleting or replacing derived pilot state. Changing production publication behavior solely for this experiment is not authorized.

## References

- [ADR-0249: Isolated registered-corpus phase A pilot](../../decisions/search/activation/0249-authorize-isolated-registered-corpus-phase-a-pilot.md)
- [Phase A collection preflight](linked-evidence-shadow-phase-a-preflight.md)
- [Execution specification](../../specifications/execution.md)
- [One-file managed-run vertical slice](../../decisions/execution/orchestration/0015-lervo-run-cli-vertical-slice.md)
- [Natural-language grounding quality roadmap](../../roadmap/natural-language-grounding-quality.md)
