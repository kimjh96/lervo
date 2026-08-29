# ADR-0278: Prepare the exact managed-context canary checkpoint

Status: `accepted`
Date: 2026-08-29

## Context

[ADR-0277](0277-stage-managed-context-relational-canary.md) requires a later execution checkpoint before any live managed-context canary call. The implementation is default-off and provider-free tests pass, but the passed [V18](../../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v18.md) population contains only selection observations. It does not bind ordinary managed task calls, read-only task enforcement, per-run recommendation and source coordinates, or operator authority for context effects.

Current user direction permits continued preparation without intermediate bookkeeping decisions. It does not provide the exact operator authority required for provider calls or managed-context effects.

## Decision

Prepare `benchmarks/search/linked-evidence-managed-canary-v1.json` and one owner-only manifest under `.lervo/state/search/linked-evidence-managed-canary-pilots/`. Preparation is provider-free and includes no execution operation.

Use the passed isolated phase-A corpus with exactly 286 registered documents and corpus digest `sha256:b14fcad0ca434b582c718b6db8d730261fb985e0a9fb8ff7fa4adf212af5ef2b`. Bind its exact prepared and passed-review evidence without copying provider result bodies.

Select the four reviewed V18 cases at repetitions one and two. Each of the eight resulting source tasks appears once in the Codex arm and once in the Claude arm, for exactly 16 task runs. Preserve V18's alternating starting-provider order. Bind each run to:

- provider and model;
- opaque run and selection-attempt identifiers;
- request and expected-path digests, without bodies or paths;
- an exact lexical recommendation-batch identifier and digest;
- the common registered-corpus source snapshot;
- exact run-specific E4-token schema and projection digests;
- candidate count, candidate digest, and provider-visible byte count; and
- reviewed expected document identifiers.

Allow one selection call and one ordinary task call per run: exactly 16 selection calls, 16 task calls, and 32 provider calls. Selection and task execution are read-only. Prohibit writes, retries, repair, fallback, replacement runs, external messages, Hub effects, direct-terminal effects, production traffic, and operational-search changes.

Record the final owner-only manifest digest in the current workstream after source, build, and verification converge. Keep it outside this ADR so the manifest can bind the repository working-tree snapshot without a self-referential edit. The manifest contains 16 runs—eight per provider—over eight paired source tasks. Reconstructed projections share one source snapshot, contain two to six candidates per run, expose at most 46,976 source bytes to a provider, and use four exact schema digests. The file mode is `0600`; exact replay yields the same manifest digest; provider-call count is zero.

The manifest remains `prepared_for_review`, `executionAuthorized=false`, and `managedContextEffectsAuthorized=false`. Before an execution operation may exist, a later operator authorization must bind this exact manifest digest and source/build snapshot. Neither preparation, this ADR, nor prior generic continuation approval grants that authority.

## Advancement and stop rules

Later execution must retain ADR-0277's complete gate: 16/16 completed runs, zero allowlisted failures, zero privacy violations, exact replay, identical non-context primary inputs, complete E1-E4 evidence, 100% required-source recall in final references, at least 50% per-run and 65% mean reference precision per provider, and independent expected-claim review.

Any failure stops execution without retry and restores the default-off predecessor. Partial evidence is diagnostic only. No result activates production behavior or direct terminals.

## Consequences

The experiment has a concrete, privacy-bounded, reproducible population for operator review. Preparation incurs no provider cost or managed-context effect. Live execution remains blocked until a separate exact authorization binds the final manifest.

## Verification

- Validate the exact contract digest and paired 16-run schedule.
- Reconstruct all recommendation batches, projections, source snapshots, and run-specific schemas through current implementation code.
- Prove manifest replay, mode `0600`, bounded fields, absence of paths, queries, bodies, and absolute repository locations, and zero provider calls.
- Run focused tests, quality and structural checks, the complete repository check, knowledge migration and lint, and exact-base release completion.

## References

- [ADR-0277](0277-stage-managed-context-relational-canary.md)
- [V18 evidence](../../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v18.md)
- [Natural-language grounding quality roadmap](../../../../roadmap/natural-language-grounding-quality.md)
