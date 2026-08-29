# Linked-evidence reconciliation confirmation v9 observation

Status: `reviewed_positive`

Observed: 2026-08-28

## Scope

This observation is the separately pre-registered exact confirmation of `linked-evidence-reconciliation-v8`. It preserved the same eight reviewed cases, expected paths, lexical expectations, three repetitions, rotating arm order, `gpt-5.6-sol`, stage protocols, protocol digest, bounded recommendation-only one-hop link expansion, deterministic coverage, no-hit behavior, scorer, thresholds, privacy policy, and failure meanings. The candidate ran against a fresh contemporaneous model-direct control.

The validator proved that the v9 suite normalizes exactly to the checked-in v8 suite after removing only the v9 confirmation metadata and v9 ADR self-exclusion. The report binds suite digest `sha256:9ad70d855145324a5d0253b023d2d5019dbae89e00ff3fede1a164ae594a413f`, unchanged protocol digest `sha256:442a90ce92cbc511bc23b69d83d01585fb747abe361351ee2c15986bb1379fe4`, corpus digest `sha256:96acb19f94eb6b402fc52c71a4a96e89346beb0bbcc5fd5fe9f4e0112ff4999d`, Git HEAD `46b36f1a192c3f6e19baa4da5d803900a2a84279`, and working-tree status digest `sha256:ae6df7f7226ccb30bf230ba4e0072da40fd2ddf731e5e25bf30a1a17d1e1c13a`.

## Result

The v9 confirmation passed every pre-registered criterion:

- The unchanged candidate passed 21/24 grounded-answer observations versus 17/24 direct and every repetition for seven of eight cases versus five direct.
- Exact expected-path recall was 100% versus 83.33%; returned-path precision was 72.22% versus 34.78%.
- Both arms recorded usage for 24/24 observations and had zero provider-execution failures.
- The candidate used 54.10% of direct observed tokens and 57.93% of direct duration.
- Candidate no-hit p95 and standard deviation were 47.83% and 27.42% of direct.
- All 24 candidate selection, coverage, reconciliation, source-marker, and response contracts passed.
- Relevant recommendation, linked-source, deterministic-coverage, and no-hit candidate drops were all zero.
- The harness recognized 62 final exact evidence references.
- The linked canonical `docs/distribution/cli-version-management.md` source was selected, loaded, and finally referenced in all six release observations.
- `docs/specifications/execution.md` was selected, loaded, and finally referenced in all three user-owned-block observations.

All three candidate grounded-answer failures were the terse release case. Each included both reviewed expected paths and additionally selected, loaded, and exactly referenced `docs/decisions/release/packaging/0223-base-bound-cli-release-completion.md`. No reviewed expected path was missing, and no reconciliation or marker contract hid the observable overselection.

The fresh direct control passed 17/24 observations. Its failures comprised all three user-owned-block repetitions omitting the execution specification, one continuation-rationale omission, and three terse-release precision failures. These are contemporaneous control evidence only and are not combined with v8.

## Privacy and retention

The raw report remains recoverable in system Trash at mode `0600`, digest `sha256:552d5da4277a679d301b4216bfc89de35bfbe20000e5ef1057c966fbc26995d5`. It contains operator-only provider prose and exact markers and is not checked in. This document contains only aggregate observations, repository-relative coordinates, contract outcomes, and content digests. It excludes provider turn identifiers, answer prose, source bodies, and absolute paths.

## Disposition

Treat v9 as positive exact-confirmation evidence. Do not combine it with either v8 report or silently activate the candidate. `lexical-v1` remains operational until a separate reviewed activation decision defines production routing, telemetry, staged verification, rollback, and release impact.
