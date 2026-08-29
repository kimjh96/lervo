# ADR-0265: Test claim coverage before minimization in v11

Status: `accepted`
Date: 2026-08-29

## Context

[V10](../../../evidence/search/linked-evidence-provider-shadow-pilot-v10.md) rejected activation after Codex omitted six reviewed sources. The [bounded diagnosis](../../../evidence/search/linked-evidence-provider-shadow-v10-codex-omission-diagnosis.md) found every omission in the identical paired candidate envelope: Codex retained a newer or operational source but dropped a distinct authority or prerequisite source. In both affected cases, the omitted source appeared first in candidate order.

The v9/v10 minimal-sufficiency protocol removes sources without first inventorying independently required claims. This permits a provider-neutral protocol correction without changing retrieval, ordering, ground truth, provider adapters, or thresholds.

## Decision

Run one paired v11 diagnostic micro-pilot on `drv8case_terse_release` and `drv8case_boundary_fuzzy_merge`, using all four immutable nonempty phase-A repetitions. This produces eight source samples, eight Codex calls, and eight Claude calls.

Replace only the selection protocol. Before minimization, require each provider to identify internally every independently required claim, authority boundary, prerequisite, and operational instruction supported by the supplied bodies, then retain direct support for each item. A newer, operational, or cross-referencing document cannot replace a distinct constraint it does not directly state. Remove a source only if another selected source directly supports the same item.

Use fresh `psv11_` coordinates, identical within-pair candidate envelopes, alternating provider order, the unchanged native exact-token carrier, and no retry, replacement, repair, answer, or publication turn. Do not expose expected paths or add case-specific routing. The cumulative v2-v11 authorization ceiling is 123 provider calls.

Each provider must independently achieve, in every observation, 100% reviewed expected-path recall and at least 50% precision; it must also achieve at least 65% mean precision, select at most eight sources, provide complete duration and usage, and have zero existing failure counts.

Passing authorizes only a separate design review for full four-case confirmation. It does not authorize that confirmation, managed context, canary traffic, direct-terminal changes, operational search, or production activation. Failure rejects v11 without retry or threshold change.

## Evidence and failure meaning

V11 preserves v10 and all predecessors. It records only bounded candidate, attempt, observation, duration, usage, selection, and no-effect evidence in owner-only local state. It excludes raw prompts, provider output, source bodies, paths, credentials, billed costs, and unrestricted errors.

A pass means only that the claim-coverage protocol met the existing gates on the two diagnosed cases. It neither proves internal reasoning nor eliminates regression risk on other reviewed cases. A failure identifies a bounded selection or execution condition; it does not imply changes to candidate retrieval, ground truth, or provider truth.

## Verification

- Bind the exact v7 base, v11 overlay, protocol digest, two cases, four repetitions, and 16 attempts.
- Reconstruct every source sample without a provider and prove identical paired request and candidate-envelope digests.
- Preserve all v10 candidates and expected document IDs for the selected cases.
- Reject stale authority, altered ground truth, extra calls, retries, incomplete usage, and every existing fail-closed condition.
- Publish provider-specific recall, precision, duration, token use, selected bytes, and disposition.

## References

- [V10 diagnosis](../../../evidence/search/linked-evidence-provider-shadow-v10-codex-omission-diagnosis.md)
- [ADR-0264](0264-measure-only-unambiguous-provider-shadow-cases-v10.md)
- [Exact v11 overlay](../../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v11.json)
