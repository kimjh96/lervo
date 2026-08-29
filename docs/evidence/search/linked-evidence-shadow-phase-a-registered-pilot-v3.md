# Linked-evidence shadow phase A registered-corpus pilot v3

Status: `observed_passed`
Date: 2026-08-28

## Question

Can the corrected provider-visible target contract complete the 30-sample two-pass phase A population authorized by [ADR-0252](../../decisions/search/activation/0252-authorize-corrected-target-delivery-phase-a-pilot.md) while preserving exact replay, privacy, bounded retention, and publication-status separation?

## Bound preparation

The owner-only manifest `sha256:a6f113f7999d5e52c50016faa269e71bf048c08642735fa06dd80ff05d8897c7` bound:

- Isolated project `prj_0f4baaded4fe4d99`.
- 286 registered documents and corpus `sha256:b14fcad0ca434b582c718b6db8d730261fb985e0a9fb8ff7fa4adf212af5ef2b`.
- Contract `sha256:127ba7583c69ba5c2f7e46e382cb2bb50f9293a483008ed14295c161f243ee32`.
- Public v8 suite `sha256:28775d1126269ce42c961d15c3b7cd8deb5affe6f7e730678f223c0b6dfd2f20`.
- Built CLI `sha256:02a473424c4f2d6e2358887f67405c5fe34877ca23341a042b688bfbdf0be2a6`.
- Source working-tree status `sha256:f61221a003fea35ef92b11e75d40f293218668d6461043afdfa449ed24d75b79`.
- 30 scheduled primary runs, 30 possible semantic-publication evaluations, and a 60-invocation maximum.

Provider-free preparation found 24 nonempty projections. The manifest recorded zero provider calls and mode `0600`. Stopped v1 and v2 remained unchanged; v3 was the only active pilot within the three-directory retention ceiling.

## Execution result

All 30 scheduled samples completed without retry or replacement. Each primary managed run emitted `run.completed`, passed its exact single-file verification suite, changed only its declared `pilot-output-NN.md`, and completed the mandatory separate semantic-publication evaluation. Each run produced exactly one immutable observed linked-evidence record.

The ordinal 2 path that stopped v2 completed successfully under the corrected target-delivery contract. No unexpected managed write, unavailable observation, source drift, contract drift, timeout, or other stop condition occurred.

The 30 eligible receipts recorded exactly 60 provider invocations: 30 primary calls and 30 semantic-publication calls. Publication was allowed for 4 samples and blocked for 26. Blocked publication remained search-eligible under the pre-registered separation contract and does not make those answers publishable.

## Review

Read-only review passed every pre-registered phase A gate:

| Measure | Result |
| --- | ---: |
| Eligible runs | 30 of 30 |
| Immutable observations | 30 |
| Nonempty projections | 24 |
| Unavailable observations | 0 |
| Replay mismatches | 0 |
| Privacy failures | 0 |
| Provider invocations | 60 of 60 maximum |
| Publication allowed | 4 |
| Publication blocked | 26 |
| Truncations | 4 |

The four truncations were ordinals 4, 12, 20, and 28, all repetitions of the Node-fleet status case. Each started with 19 candidates, retained the configured maximum of 8 candidates in 42,013 bytes, and replayed exactly. The records stayed below the 65,536-byte linked-body ceiling and exposed no forbidden repository path, query, or source-path value.

## Boundary

This observation passes the isolated phase A incidence, determinism, bounds, and privacy gate. It proves neither answer quality nor provider use of the shadow projection. Operational search remains unchanged, and the shadow did not alter provider context, output, writes, direct terminals, or E1-E4 evidence.

The result does not authorize provider-shadow selection, managed context injection, canary traffic, or production activation. Any such step requires a separate reviewed decision, explicit authority, and a new bounded evidence contract.

## References

- [ADR-0248: Stage linked-evidence reconciliation activation](../../decisions/search/0248-stage-linked-evidence-reconciliation-activation.md)
- [ADR-0250: Authorize two-pass registered-corpus phase A pilot](../../decisions/search/activation/0250-authorize-two-pass-registered-corpus-phase-a-pilot.md)
- [ADR-0251: Declare each managed write target to the provider](../../decisions/execution/orchestration/0251-declare-each-managed-write-target-to-provider.md)
- [ADR-0252: Authorize corrected-target-delivery phase A pilot](../../decisions/search/activation/0252-authorize-corrected-target-delivery-phase-a-pilot.md)
- [Pilot v2 evidence](linked-evidence-shadow-phase-a-registered-pilot-v2.md)
- [Execution specification](../../specifications/execution.md)
- [Natural-language grounding quality roadmap](../../roadmap/natural-language-grounding-quality.md)
