# Linked-evidence reconciliation v8 observation

Status: `reviewed_negative`

Observed: 2026-08-28

## Scope

This observation evaluates the pre-registered `linked-evidence-reconciliation-v8` arm against contemporaneous model-direct exploration. The corrected run used eight human-reviewed cases, three repetitions per arm, rotating arm order, `gpt-5.6-sol`, lexical-v1 top-three recommendations, unchanged v7 deterministic coverage and no-hit behavior, recommendation-only bounded one-hop inline Markdown links for lexical hits, and exact hit selection-to-final-reference reconciliation.

The report binds suite digest `sha256:f6e7361856b13df03de1f1aa278dd9cc5cf488527f9d33cc13fb0a69b8db22de`, protocol digest `sha256:442a90ce92cbc511bc23b69d83d01585fb747abe361351ee2c15986bb1379fe4`, corpus digest `sha256:96acb19f94eb6b402fc52c71a4a96e89346beb0bbcc5fd5fe9f4e0112ff4999d`, Git HEAD `46b36f1a192c3f6e19baa4da5d803900a2a84279`, and working-tree status digest `sha256:2390d79d3ba75cbb5f2be0ffcef8a0ce346bc16575de8ce0be3daa6ce8495d41`.

## Result

V8 is rejected because the token-ratio criterion requires complete usage observations in both arms, while one model-direct provider execution failed. Model direct recorded usage for 23/24 observations; v8 recorded 24/24. The observed v8-to-direct token ratio was 56.92%, but incomplete control usage prevents the pre-registered token criterion from passing and the ratio from establishing resource acceptance.

All other pre-registered criteria passed:

- V8 achieved 21/24 grounded-answer verdicts versus 16/24 direct and passed every repetition for seven of eight cases versus four direct.
- Exact expected-path recall was 100% versus 79.17%; returned-path precision was 65.97% versus 33.89%.
- V8 used 53.84% of direct observed duration. Its no-hit p95 and standard deviation were 32.45% and 16.88% of direct.
- All 24 selection, coverage, and reconciliation contracts passed. All 24 source-marker and response contracts passed. V8 had complete usage and zero provider execution failures.
- The harness recognized 67 final exact evidence references. Relevant recommendation, linked-source, deterministic-coverage, and no-hit candidate drops were all zero.
- The linked canonical `docs/distribution/cli-version-management.md` source was selected, loaded, and finally referenced in all six release-case repetitions.
- The execution specification was selected, loaded, and finally referenced in all three user-owned-block repetitions, closing the stable v7 omission.

All three v8 grounded-answer failures involved the terse release case. Each returned both reviewed expected paths plus `docs/decisions/release/packaging/0223-base-bound-cli-release-completion.md`. Exact hit reconciliation preserved that selected source, so the scorer recorded an unexpected path rather than hiding overselection. No reviewed expected path was missing.

The model-direct failure occurred in repetition three of the Node-fleet case and was recorded as `provider_execution_failed`. This was a control completeness failure, not a v8 provider failure. The result must not be reinterpreted by deleting that observation, borrowing control usage from another run, or combining reports.

## Discarded precursor

The first provider run was discarded before adoption because its stage-two prompt said every supplied body, instructing the provider to reference the harness protocol document. All 18 lexical-hit answers complied, conflicting with the ADR's selected repository evidence set. The prompt was corrected to exclude the protocol document, its digest and the suite digest changed, and the full comparison was rerun.

The discarded raw report remains recoverable in system Trash at mode `0600`, digest `sha256:95b57bf1746eceba0f67a5e7249dfb07eef5ef7b7c9c34b3b033ea187c0ea591`. It contributes no adopted quality or resource observation.

## Privacy and retention

The accepted negative raw report remains recoverable in system Trash at mode `0600`, digest `sha256:be04cddfba36a3d2fc645cac83d49fa88a77fb6941fd9d3dd2e8ef6a2ab7a505`. It contains operator-only provider prose and exact markers and is not checked in. This document contains only aggregate observations, repository-relative coordinates, contract outcomes, and content digests. It excludes provider turn identifiers, answer prose, source bodies, and absolute paths.

## Disposition

Keep `lexical-v1` operational. V8 is not authorized for activation or provenance promotion because one required criterion failed. The strong quality, reference, preservation, latency, and v8 execution observations warrant one separately pre-registered exact confirmatory replication with a fresh contemporaneous control. That replication must retain the same cases, ground truth, protocol, bounds, scorer, thresholds, and failure meanings; it must not reuse or merge token observations from this run.
