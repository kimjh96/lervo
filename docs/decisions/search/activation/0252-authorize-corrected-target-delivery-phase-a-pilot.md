# ADR-0252: Authorize corrected-target-delivery phase A pilot

Status: `accepted`
Date: 2026-08-28

## Context

[Pilot v2](../../../evidence/search/linked-evidence-shadow-phase-a-registered-pilot-v2.md) stopped without retry because ordinal 2 did not receive its exact single-file target in provider-visible instructions. [ADR-0251](../../execution/orchestration/0251-declare-each-managed-write-target-to-provider.md) corrected the provider-neutral orchestration contract, and complete repository verification passed. The user authorized a fresh 30-sample v3 population with at most 60 additional provider invocations.

Pilot v1 and v2 remain immutable stopped evidence. Their owner-only derived directories fill the prior two-pilot retention bound. Another pilot therefore requires deleting evidence or extending bounded local retention; this decision does not authorize deletion.

## Decision

Use contract `benchmarks/search/linked-evidence-shadow-phase-a-pilot-v3.json` and pilot ID `linked-evidence-shadow-phase-a-registered-v8-corrected-target-v3-20260828`. Build one fresh, isolated registered corpus from the unchanged public v8 suite. Exclude ADR-0249, ADR-0250, ADR-0251, this decision, and the v1 and v2 evidence publications so experiment-control and repair documentation cannot affect retrieval.

Retain all three owner-only pilot directories. Raise `maximumPilots` from two to three and keep `maximumActivePilots` at one. Do not delete, resume, retry, or mutate v1 or v2. Keep the canonical repository registry, operational search selection, managed context, direct terminals, and project identity unchanged.

Before any provider call:

- Complete focused tests, quality, documentation, knowledge migration and lint, the complete repository check, and task-base release completion.
- Prepare v3 without provider calls.
- Bind the source snapshot, working-tree-status digest, contract and suite digests, built CLI digest, isolated project, ordered corpus, dry-run projections, and exact 30-run schedule in one owner-only manifest.
- Record the manifest digest in the current workstream.

Permit at most 30 primary Codex managed task invocations, 30 mandatory separate Codex semantic-publication evaluations, and 60 provider invocations total. Do not add retries, replacement samples, grounding calls, provider shadow, repair turns, or canary effects. Any reviewed stop condition ends v3 without retry.

Keep the v2 eligibility and review rules unchanged. A sample requires `run.completed`, passed verification, exactly its declared output path, a completed semantic-publication evaluation, an allowed status-0 or blocked status-1 publication result, and exactly one immutable observed linked-evidence record.

The final gate requires exactly 30 eligible observations, at least 10 nonempty projections, zero unavailable records, zero replay mismatches, zero privacy failures, explicit truncation review, and no more than 60 provider invocations.

## Failure meaning

The `managed_run_incomplete` and `semantic_publication_evaluation_incomplete` meanings from ADR-0250 remain unchanged. Existing shadow failure codes retain their ADR-0248 meanings. No failure authorizes retry, sample replacement, additional provider calls, publication changes, provider-shadow selection, or canary effects.

## Consequences

A passing v3 completes only the isolated phase A incidence, determinism, bounds, and privacy gate. It cannot prove answer quality, provider use, general production incidence, provider-shadow authority, or canary authority. Any provider-shadow or canary step requires a separate reviewed decision and user authority.

## Observed outcome

[Pilot v3](../../../evidence/search/linked-evidence-shadow-phase-a-registered-pilot-v3.md) completed all 30 samples without retry or replacement and passed the pre-registered review. It produced 30 immutable observations, 24 nonempty projections, zero unavailable records, zero replay mismatches, and zero privacy failures. Receipts recorded exactly 60 provider invocations; publication was allowed for 4 samples and blocked for 26.

Four Node-fleet repetitions truncated 19 candidates to the configured maximum of 8 retained candidates and 42,013 bytes. Each replayed exactly and remained below the linked-body byte ceiling. This passes only the isolated phase A incidence, determinism, bounds, and privacy gate; provider-shadow selection, canary traffic, and production activation remain unauthorized.

## Verification

- Focused contract tests prove the exact v3 decision, 30-run schedule, 60-invocation cap, three-pilot retention ceiling, and one-active-pilot ceiling.
- Provider-free preparation proves exact source, CLI, contract, corpus, schedule, and projection bindings before execution.
- Execution and review prove completion, exact writes, publication evaluation, immutable observation count, replay, privacy, truncation, and invocation totals.
- Run complete repository verification, knowledge lifecycle, and task-base release-completion contracts before provider preparation and again after canonical outcome documentation.

## References

- [ADR-0248: Stage linked-evidence reconciliation activation](../0248-stage-linked-evidence-reconciliation-activation.md)
- [ADR-0250: Authorize two-pass registered-corpus phase A pilot](0250-authorize-two-pass-registered-corpus-phase-a-pilot.md)
- [ADR-0251: Declare each managed write target to the provider](../../execution/orchestration/0251-declare-each-managed-write-target-to-provider.md)
- [Pilot v1 evidence](../../../evidence/search/linked-evidence-shadow-phase-a-registered-pilot-v1.md)
- [Pilot v2 evidence](../../../evidence/search/linked-evidence-shadow-phase-a-registered-pilot-v2.md)
- [Pilot v3 evidence](../../../evidence/search/linked-evidence-shadow-phase-a-registered-pilot-v3.md)
- [Execution specification](../../../specifications/execution.md)
- [Natural-language grounding quality roadmap](../../../roadmap/natural-language-grounding-quality.md)
